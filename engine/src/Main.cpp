#include <JuceHeader.h>
#include "AudioEngine.h"
#include "IPCBridge.h"
#include "PresetManager.h"
#include <map>
#include <functional>

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build an event object with a mandatory "event" key
// ─────────────────────────────────────────────────────────────────────────────
static juce::DynamicObject* makeEvent(const juce::String& type)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("event", type);
    return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Level timer: streams input/output levels to Electron at ~30 fps
// ─────────────────────────────────────────────────────────────────────────────
class LevelTimer : public juce::Timer
{
public:
    LevelTimer(AudioEngine& engine, IPCBridge& ipc)
        : engine(engine), ipc(ipc) {}

    void timerCallback() override
    {
        auto* obj = makeEvent("levels");
        obj->setProperty("input",  engine.getInputLevel());
        obj->setProperty("output", engine.getOutputLevel());
        ipc.sendEvent(obj);

        // Notify the UI once when plugin parameters change (incl. from editors)
        if (engine.consumeParamDirty())
            ipc.sendEvent(makeEvent("modified"));
    }

private:
    AudioEngine& engine;
    IPCBridge&   ipc;
};

// ─────────────────────────────────────────────────────────────────────────────
// Plugin editor window: hosts a plugin's native GUI in a separate OS window
// (just like a DAW). onClose is called when the user closes it.
// ─────────────────────────────────────────────────────────────────────────────
// Dark title bar + muted close button to match the VSTHost app chrome
class EditorLookAndFeel : public juce::LookAndFeel_V4
{
public:
    void drawDocumentWindowTitleBar(juce::DocumentWindow& window, juce::Graphics& g,
                                    int w, int h, int titleSpaceX, int titleSpaceW,
                                    const juce::Image*, bool) override
    {
        g.fillAll(juce::Colour(0xff161922));                 // --bg-surface
        g.setColour(juce::Colour(0xff2a3040));               // --border (bottom hairline)
        g.fillRect(0, h - 1, w, 1);
        g.setColour(juce::Colour(0xfff1f3f8));               // --text-primary
        g.setFont(juce::Font(13.0f, juce::Font::bold));
        g.drawText(window.getName(), titleSpaceX, 0, titleSpaceW, h,
                   juce::Justification::centred, true);
    }

    void positionDocumentWindowButtons(juce::DocumentWindow&,
                                       int titleBarX, int titleBarY, int titleBarW, int titleBarH,
                                       juce::Button* minimise, juce::Button* maximise, juce::Button* close,
                                       bool positionTitleBarButtonsOnLeft) override
    {
        const int sz = 11;
        const int gap = 12;
        int x = positionTitleBarButtonsOnLeft ? titleBarX + gap
                                              : titleBarX + titleBarW - sz - gap;
        const int y = titleBarY + (titleBarH - sz) / 2;
        if (close)    close->setBounds(x, y, sz, sz);
        if (maximise) maximise->setBounds(0, 0, 0, 0);
        if (minimise) minimise->setBounds(0, 0, 0, 0);
    }

    juce::Button* createDocumentWindowButton(int buttonType) override
    {
        if (buttonType == juce::DocumentWindow::closeButton)
        {
            // Muted X that turns red on hover (matches the app's title bar X)
            juce::Path line, x;
            line.startNewSubPath(0.0f, 0.0f); line.lineTo(1.0f, 1.0f);
            line.startNewSubPath(1.0f, 0.0f); line.lineTo(0.0f, 1.0f);
            juce::PathStrokeType(0.22f).createStrokedPath(x, line);

            auto* b = new juce::ShapeButton("close",
                                            juce::Colour(0xff6b7689),   // --text-muted
                                            juce::Colour(0xffff5555),   // hover red
                                            juce::Colour(0xffff5555));
            b->setShape(x, false, true, false);
            return b;
        }
        return juce::LookAndFeel_V4::createDocumentWindowButton(buttonType);
    }
};

class PluginEditorWindow : public juce::DocumentWindow
{
public:
    PluginEditorWindow(const juce::String& title,
                       juce::AudioProcessorEditor* editor,
                       std::function<void()> onClose)
        : juce::DocumentWindow(title, juce::Colour(0xff161922),
                               juce::DocumentWindow::closeButton),
          onCloseCb(std::move(onClose))
    {
        // JUCE's own slim dark title bar reads as more "discrete" than the
        // chunky native Windows one, themed to match the app.
        static EditorLookAndFeel lnf;
        setLookAndFeel(&lnf);
        setUsingNativeTitleBar(false);
        setTitleBarHeight(28);
        setContentOwned(editor, true);
        setResizable(editor->isResizable(), false);
        centreWithSize(juce::jmax(200, editor->getWidth()),
                       juce::jmax(100, editor->getHeight()));

        setVisible(true);
        // Force to the foreground — the engine is a background process so a
        // plain toFront() often opens the window behind others.
        setAlwaysOnTop(true);
        toFront(true);
        if (auto* peer = getPeer()) peer->toFront(true);
        setAlwaysOnTop(false);
        grabKeyboardFocus();
    }

    void closeButtonPressed() override
    {
        if (onCloseCb) onCloseCb();   // owner defers deletion via callAsync
    }

private:
    std::function<void()> onCloseCb;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main JUCE Application
// ─────────────────────────────────────────────────────────────────────────────
class VSTHostApp : public juce::JUCEApplicationBase
{
public:
    const juce::String getApplicationName()    override { return "VSTHostEngine"; }
    const juce::String getApplicationVersion() override { return "1.0.0"; }
    bool moreThanOneInstanceAllowed()           override { return false; }

    void initialise(const juce::String&) override
    {
        // ── Set up IPC first so we can report errors ─────────────────────────
        ipc = std::make_unique<IPCBridge>();
        ipc->setCommandHandler([this](const juce::var& cmd) { handleCommand(cmd); });
        ipc->startThread();

        // ── Start audio engine ───────────────────────────────────────────────
        engine = std::make_unique<AudioEngine>();
        const auto err = engine->initialise();

        if (err.isNotEmpty())
        {
            auto* e = makeEvent("error");
            e->setProperty("message", "Audio engine failed to start: " + err);
            ipc->sendEvent(e);
        }

        // ── Presets ──────────────────────────────────────────────────────────
        presets = std::make_unique<PresetManager>();

        // ── Level streaming ──────────────────────────────────────────────────
        levelTimer = std::make_unique<LevelTimer>(*engine, *ipc);
        levelTimer->startTimerHz(30);

        // ── Signal ready ─────────────────────────────────────────────────────
        {
            auto* e = makeEvent("ready");
            e->setProperty("sampleRate",   engine->getCurrentSampleRate());
            e->setProperty("bufferSize",   engine->getCurrentBufferSize());
            e->setProperty("backend",      engine->getCurrentBackend());
            e->setProperty("inputDevice",  engine->getCurrentInputDevice());
            e->setProperty("outputDevice", engine->getCurrentOutputDevice());
            ipc->sendEvent(e);
        }

        sendDeviceList();
        sendChain();

        // Proactively push the preset list on startup so the UI always has it
        // even if its request races the engine coming up.
        {
            auto* e = makeEvent("preset_list");
            e->setProperty("list", presets->listPresets());
            ipc->sendEvent(e);
        }
    }

    void shutdown() override
    {
        editors.clear();          // close any plugin editor windows
        levelTimer.reset();
        if (engine) engine->shutdown();
    }

    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted(const juce::String&) override {}

    // ── Remaining JUCEApplicationBase pure virtuals ──────────────────────────
    void suspended() override {}
    void resumed() override {}
    void unhandledException(const std::exception*, const juce::String&, int) override {}
    bool backButtonPressed() override { return false; }

private:
    std::unique_ptr<AudioEngine>    engine;
    std::unique_ptr<IPCBridge>      ipc;
    std::unique_ptr<PresetManager>  presets;
    std::unique_ptr<LevelTimer>     levelTimer;

    // Open plugin editor windows, keyed by slot uid
    std::map<juce::String, std::unique_ptr<PluginEditorWindow>> editors;

    // ── Helpers ───────────────────────────────────────────────────────────────
    void sendDeviceList()
    {
        auto* e = makeEvent("devices");
        auto devVar = engine->getDeviceListVar();
        auto chVar  = engine->getChannelsVar();
        e->setProperty("inputs",        devVar["inputs"]);
        e->setProperty("outputs",       devVar["outputs"]);
        e->setProperty("types",         devVar["types"]);
        e->setProperty("backend",       engine->getCurrentBackend());
        e->setProperty("inputDevice",   engine->getCurrentInputDevice());
        e->setProperty("outputDevice",  engine->getCurrentOutputDevice());
        e->setProperty("inputChannels", chVar["inputs"]);
        e->setProperty("outputChannels", chVar["outputs"]);
        e->setProperty("inputChannel",  chVar["inputChannel"]);
        e->setProperty("outputChannel", chVar["outputChannel"]);
        e->setProperty("sampleRate",    engine->getCurrentSampleRate());
        e->setProperty("bufferSize",    engine->getCurrentBufferSize());
        ipc->sendEvent(e);
    }

    void sendChain()
    {
        auto* e = makeEvent("chain");
        e->setProperty("plugins",   engine->chain().toVar());
        e->setProperty("bypassAll", engine->chain().isBypassAll());
        ipc->sendEvent(e);
    }

    void sendOk(const juce::String& forCmd)
    {
        auto* e = makeEvent("ok");
        e->setProperty("cmd", forCmd);
        ipc->sendEvent(e);
    }

    void sendError(const juce::String& msg)
    {
        auto* e = makeEvent("error");
        e->setProperty("message", msg);
        ipc->sendEvent(e);
    }

    // ── Plugin editor windows ─────────────────────────────────────────────────
    void openEditor(int index)
    {
        const auto* slot = engine->chain().getSlot(index);
        if (!slot || !slot->instance) { sendError("No plugin at slot " + juce::String(index)); return; }

        const juce::String uid = slot->uid;

        // Already open → just bring to front
        if (auto it = editors.find(uid); it != editors.end())
        {
            it->second->toFront(true);
            return;
        }

        auto* editor = slot->instance->createEditorIfNeeded();
        if (!editor) { sendError("\"" + slot->description.name + "\" has no editor UI"); return; }

        auto win = std::make_unique<PluginEditorWindow>(
            slot->description.name, editor,
            [this, uid]() {
                // Defer deletion so we don't destroy the window inside its own callback
                juce::MessageManager::callAsync([this, uid]() {
                    editors.erase(uid);
                    auto* e = makeEvent("editor_closed");
                    e->setProperty("uid", uid);
                    ipc->sendEvent(e);
                });
            });

        editors[uid] = std::move(win);

        auto* e = makeEvent("editor_opened");
        e->setProperty("uid", uid);
        ipc->sendEvent(e);
    }

    void closeEditor(int index)
    {
        const auto* slot = engine->chain().getSlot(index);
        if (!slot) return;
        editors.erase(slot->uid);
    }

    // Rebuild a chain from preset data, loading each plugin asynchronously and
    // in order (sync VST3 instantiation is unreliable).
    void loadChainAsync(juce::Array<juce::var> slots, int index)
    {
        if (index >= slots.size()) { engine->clearParamDirty(); sendChain(); return; }

        const juce::var slot = slots[index];
        juce::PluginDescription desc;
        if (!engine->scanner().describePlugin(slot["file"].toString(), slot["identifier"].toString(), desc))
        {
            sendError("Could not describe: " + slot["file"].toString());
            loadChainAsync(slots, index + 1);
            return;
        }

        double sr = engine->getCurrentSampleRate(); if (sr <= 0) sr = 48000.0;
        int    bs = engine->getCurrentBufferSize(); if (bs <= 0) bs = 512;

        engine->scanner().getFormatManager().createPluginInstanceAsync(
            desc, sr, bs,
            [this, slots, index, slot, desc](std::unique_ptr<juce::AudioPluginInstance> inst,
                                             const juce::String& err)
            {
                if (!inst)
                    sendError("Load failed (" + desc.name + "): " + err);
                if (inst)
                {
                    // Prefer the full state blob (complete fidelity); fall back
                    // to individual normalized parameters.
                    const juce::String state = slot["state"].toString();
                    if (state.isNotEmpty())
                    {
                        juce::MemoryBlock mb;
                        if (mb.fromBase64Encoding(state))
                            inst->setStateInformation(mb.getData(), (int) mb.getSize());
                    }
                    else if (const auto* params = slot["parameters"].getArray())
                    {
                        for (const auto& p : *params)
                        {
                            int idx = (int)p["index"];
                            auto& ps = inst->getParameters();
                            if (juce::isPositiveAndBelow(idx, ps.size()))
                                ps[idx]->setValue((float)p["value"]);
                        }
                    }

                    engine->chain().addPlugin(std::move(inst), desc);
                    int slotIdx = engine->chain().numPlugins() - 1;
                    engine->chain().setEnabled (slotIdx, (bool) slot.getProperty("enabled",  true));
                    engine->chain().setBypassed(slotIdx, (bool) slot.getProperty("bypassed", false));
                }
                loadChainAsync(slots, index + 1);   // next plugin
            });
    }

    // ── IPC command dispatcher ────────────────────────────────────────────────
    void handleCommand(const juce::var& cmd)
    {
        const juce::String type = cmd["cmd"].toString();

        // ── Audio device control ──────────────────────────────────────────────
        if (type == "get_devices")
        {
            sendDeviceList();
        }
        else if (type == "set_input_device")
        {
            auto err = engine->setInputDevice(cmd["name"].toString());
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }
        else if (type == "set_output_device")
        {
            auto err = engine->setOutputDevice(cmd["name"].toString());
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }
        else if (type == "set_sample_rate")
        {
            auto err = engine->setSampleRate((double)cmd["value"]);
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }
        else if (type == "set_buffer_size")
        {
            auto err = engine->setBufferSize((int)cmd["value"]);
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }
        else if (type == "set_backend")
        {
            auto err = engine->setBackend(cmd["name"].toString());
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }
        else if (type == "set_input_gain")
        {
            engine->setInputGainDb((float)cmd["value"]);
        }
        else if (type == "set_output_gain")
        {
            engine->setOutputGainDb((float)cmd["value"]);
        }
        else if (type == "set_input_channel")
        {
            auto err = engine->setInputChannel((int)cmd["index"]);
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }
        else if (type == "set_output_channel")
        {
            auto err = engine->setOutputChannel((int)cmd["index"]);
            if (err.isEmpty()) sendDeviceList();
            else sendError(err);
        }

        // ── Plugin scanning ───────────────────────────────────────────────────
        else if (type == "scan_plugins")
        {
            juce::StringArray paths;
            if (const auto* arr = cmd["paths"].getArray())
                for (const auto& p : *arr)
                    paths.add(p.toString());
            // The scanner already includes the VST3 default location
            // (C:\Program Files\Common Files\VST3) automatically.

            engine->scanner().scan(
                paths,
                [this](const juce::String& name, float progress) {
                    auto* e = makeEvent("scan_progress");
                    e->setProperty("plugin",   name);
                    e->setProperty("progress", progress);
                    ipc->sendEvent(e);
                },
                [this](const juce::var& pluginList) {
                    auto* e = makeEvent("plugins_scanned");
                    e->setProperty("plugins", pluginList);
                    ipc->sendEvent(e);
                });
        }

        // ── Plugin chain ──────────────────────────────────────────────────────
        else if (type == "add_plugin")
        {
            const juce::String file = cmd["file"].toString();
            const juce::String uid  = cmd["uid"].toString();

            juce::PluginDescription desc;
            if (!engine->scanner().describePlugin(file, uid, desc))
            {
                sendError("Plugin not found or unreadable:\n" + file);
                return;
            }

            double sr = engine->getCurrentSampleRate(); if (sr <= 0) sr = 48000.0;
            int    bs = engine->getCurrentBufferSize(); if (bs <= 0) bs = 512;
            const int insertAt = cmd.hasProperty("index") ? (int)cmd["index"] : -1;

            // Async load is the reliable path for VST3 (handles COM threading).
            engine->scanner().getFormatManager().createPluginInstanceAsync(
                desc, sr, bs,
                [this, desc, insertAt](std::unique_ptr<juce::AudioPluginInstance> inst,
                                       const juce::String& err)
                {
                    if (!inst)
                    {
                        sendError("Could not load \"" + desc.name + "\": " +
                                  (err.isNotEmpty() ? err : juce::String("unknown error")));
                        return;
                    }
                    engine->chain().addPlugin(std::move(inst), desc);
                    if (insertAt >= 0)
                    {
                        const int last = engine->chain().numPlugins() - 1;
                        if (insertAt < last) engine->chain().movePlugin(last, insertAt);
                    }
                    sendChain();
                });
        }
        else if (type == "remove_plugin")
        {
            // Close its editor window first so we don't reference a freed instance
            if (const auto* slot = engine->chain().getSlot((int)cmd["index"]))
                editors.erase(slot->uid);
            engine->chain().removePlugin((int)cmd["index"]);
            sendChain();
        }
        else if (type == "move_plugin")
        {
            engine->chain().movePlugin((int)cmd["from"], (int)cmd["to"]);
            sendChain();
        }
        else if (type == "set_plugin_enabled")
        {
            engine->chain().setEnabled((int)cmd["index"], (bool)cmd["value"]);
            sendChain();
        }
        else if (type == "set_plugin_bypassed")
        {
            engine->chain().setBypassed((int)cmd["index"], (bool)cmd["value"]);
            sendChain();
        }
        else if (type == "bypass_all")
        {
            engine->chain().setBypassAll((bool)cmd["value"]);
            sendChain();
        }

        // ── Parameters ────────────────────────────────────────────────────────
        else if (type == "set_param")
        {
            engine->chain().setParameter(
                (int)cmd["slotIndex"], (int)cmd["paramIndex"], (float)cmd["value"]);
            // Don't re-send full chain on every param change — too noisy
            // UI owns optimistic updates; engine is ground truth on load/save
        }

        // ── Presets ───────────────────────────────────────────────────────────
        else if (type == "save_preset")
        {
            const bool ok = presets->savePreset(
                cmd["name"].toString(),
                engine->chain().toVar(),
                (float)cmd["inputGain"],
                (float)cmd["outputGain"]);

            auto* e = makeEvent("preset_saved");
            e->setProperty("ok",   ok);
            e->setProperty("name", cmd["name"].toString());
            e->setProperty("list", presets->listPresets());
            ipc->sendEvent(e);
        }
        else if (type == "load_preset")
        {
            const juce::var data = presets->loadPreset(cmd["name"].toString());
            if (!data.isObject()) { sendError("Preset not found"); return; }

            // Clear chain (and any open editor windows), reload from preset data
            editors.clear();
            while (engine->chain().numPlugins() > 0)
                engine->chain().removePlugin(0);

            if (const auto* arr = data["chain"].getArray())
            {
                for (const auto& slot : *arr)
                {
                    juce::PluginDescription desc;
                    if (!engine->scanner().describeFile(slot["file"].toString(), desc))
                        continue;

                    double sr = engine->getCurrentSampleRate(); if (sr <= 0) sr = 48000.0;
                    int    bs = engine->getCurrentBufferSize(); if (bs <= 0) bs = 512;
                    juce::String errMsg;
                    auto inst = engine->scanner().getFormatManager()
                        .createPluginInstance(desc, sr, bs, errMsg);

                    if (!inst) continue;

                    // Restore parameters
                    if (const auto* params = slot["parameters"].getArray())
                    {
                        for (const auto& p : *params)
                        {
                            int idx = (int)p["index"];
                            auto& ps = inst->getParameters();
                            if (juce::isPositiveAndBelow(idx, ps.size()))
                                ps[idx]->setValue((float)p["value"]);
                        }
                    }

                    engine->chain().addPlugin(std::move(inst), desc);

                    // enabled / bypassed state
                    int slotIdx = engine->chain().numPlugins() - 1;
                    engine->chain().setEnabled (slotIdx, (bool)slot["enabled"]);
                    engine->chain().setBypassed(slotIdx, (bool)slot["bypassed"]);
                }
            }

            auto* e = makeEvent("preset_loaded");
            e->setProperty("name",        data["name"].toString());
            e->setProperty("inputGain",   data["inputGain"]);
            e->setProperty("outputGain",  data["outputGain"]);
            e->setProperty("chain",       engine->chain().toVar());
            ipc->sendEvent(e);
        }
        else if (type == "list_presets")
        {
            auto* e = makeEvent("preset_list");
            e->setProperty("list", presets->listPresets());
            ipc->sendEvent(e);
        }
        else if (type == "delete_preset")
        {
            presets->deletePreset(cmd["name"].toString());
            auto* e = makeEvent("preset_list");
            e->setProperty("list", presets->listPresets());
            ipc->sendEvent(e);
        }

        // ── Load a chain passed directly from the UI (Rust-managed presets) ────
        else if (type == "load_chain")
        {
            editors.clear();
            while (engine->chain().numPlugins() > 0)
                engine->chain().removePlugin(0);

            juce::Array<juce::var> slots;
            if (const auto* arr = cmd["chain"].getArray())
                slots = *arr;
            loadChainAsync(slots, 0);   // async = reliable VST3 instantiation
        }

        // ── Plugin editor windows ─────────────────────────────────────────────
        else if (type == "open_editor")
        {
            openEditor((int)cmd["index"]);
        }
        else if (type == "close_editor")
        {
            closeEditor((int)cmd["index"]);
        }

        // ── Info ──────────────────────────────────────────────────────────────
        else if (type == "get_chain")
        {
            sendChain();
        }
        else if (type == "ping")
        {
            sendOk("ping");
        }
    }
};

START_JUCE_APPLICATION(VSTHostApp)
