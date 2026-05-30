#include "AudioEngine.h"

// Callback for the virtual-output (send) device: pulls processed audio from
// the engine's FIFO and writes it to the second device's output.
struct SendDeviceCallback : public juce::AudioIODeviceCallback
{
    explicit SendDeviceCallback(AudioEngine& e) : engine(e) {}
    void audioDeviceIOCallbackWithContext(const float* const*, int,
                                          float* const* output, int numOutputChannels,
                                          int numSamples,
                                          const juce::AudioIODeviceCallbackContext&) override
    {
        engine.pullSendAudio(output, numOutputChannels, numSamples);
    }
    void audioDeviceAboutToStart(juce::AudioIODevice*) override {}
    void audioDeviceStopped() override {}
    AudioEngine& engine;
};

AudioEngine::AudioEngine()
{
    pluginChain.onParameterChanged = [this] { paramDirty.store(true); };
    sendRing.setSize(2, 1 << 15);
    sendCallback = std::make_unique<SendDeviceCallback>(*this);
}

// ── Virtual-output FIFO bridge ───────────────────────────────────────────────
void AudioEngine::pushSendAudio(const juce::AudioBuffer<float>& buf, int numSamples, bool silence)
{
    int s1, sz1, s2, sz2;
    sendFifo.prepareToWrite(numSamples, s1, sz1, s2, sz2);
    for (int ch = 0; ch < 2; ++ch)
    {
        const int src = juce::jmin(ch, buf.getNumChannels() - 1);
        const float* in = buf.getReadPointer(src);
        if (silence)
        {
            if (sz1) sendRing.clear(ch, s1, sz1);
            if (sz2) sendRing.clear(ch, s2, sz2);
        }
        else
        {
            if (sz1) sendRing.copyFrom(ch, s1, in,        sz1);
            if (sz2) sendRing.copyFrom(ch, s2, in + sz1,  sz2);
        }
    }
    sendFifo.finishedWrite(sz1 + sz2);
}

void AudioEngine::pullSendAudio(float* const* out, int numOut, int numSamples)
{
    int s1, sz1, s2, sz2;
    sendFifo.prepareToRead(numSamples, s1, sz1, s2, sz2);
    for (int ch = 0; ch < numOut; ++ch)
    {
        if (!out[ch]) continue;
        const int src = juce::jmin(ch, 1);
        if (sz1) juce::FloatVectorOperations::copy(out[ch],       sendRing.getReadPointer(src, s1), sz1);
        if (sz2) juce::FloatVectorOperations::copy(out[ch] + sz1, sendRing.getReadPointer(src, s2), sz2);
        for (int i = sz1 + sz2; i < numSamples; ++i) out[ch][i] = 0.0f;   // underrun → silence
    }
    sendFifo.finishedRead(sz1 + sz2);
}

juce::StringArray AudioEngine::getOutputDevicesFor(const juce::String& backendType)
{
    juce::StringArray names;
    for (auto* t : dm.getAvailableDeviceTypes())
        if (t->getTypeName() == backendType)
        {
            t->scanForDevices();
            names = t->getDeviceNames(false);   // outputs
            break;
        }
    return names;
}

juce::String AudioEngine::setVirtualOutput(const juce::String& deviceName)
{
    // Tear down any existing send device
    sendActive.store(false);
    if (sendCallback) sendDm.removeAudioCallback(sendCallback.get());
    sendDm.closeAudioDevice();
    virtualOutName = {};

    if (deviceName.isEmpty()) return {};

    // A fresh AudioDeviceManager has NO device types until they're created.
    // Touching the type list forces JUCE to build the default backends so that
    // setCurrentAudioDeviceType("Windows Audio") actually resolves to a type.
    sendDm.getAvailableDeviceTypes();
    sendDm.setCurrentAudioDeviceType("Windows Audio", true);
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    setup.outputDeviceName         = deviceName;
    setup.inputDeviceName          = {};
    setup.sampleRate               = getCurrentSampleRate();
    setup.useDefaultOutputChannels = true;
    auto err = sendDm.setAudioDeviceSetup(setup, true);
    if (err.isNotEmpty()) return "Virtual output: " + err;

    sendFifo.reset();
    sendDm.addAudioCallback(sendCallback.get());
    virtualOutName = deviceName;
    sendActive.store(true);

    // Warn (but don't fail) if the virtual output opened at a different sample
    // rate than the main device — the send will work but audio will drift/pitch-shift.
    if (auto* sendDev = sendDm.getCurrentAudioDevice())
    {
        double sendSr = sendDev->getCurrentSampleRate();
        double mainSr = getCurrentSampleRate();
        if (mainSr > 0 && std::abs(sendSr - mainSr) > 1.0)
            return "warning:Virtual output opened at " + juce::String((int)sendSr)
                   + " Hz but your main device runs at " + juce::String((int)mainSr)
                   + " Hz — set them to match in Windows Sound settings to avoid drift.";
    }
    return {};
}

AudioEngine::~AudioEngine()
{
    shutdown();
}

juce::String AudioEngine::initialise()
{
    // Try to open the default devices: 1 input channel (mic), 2 output channels
    auto err = dm.initialiseWithDefaultDevices(1, 2);
    if (err.isNotEmpty())
    {
        // Fall back: try any available device
        err = dm.initialise(1, 2, nullptr, true);
        if (err.isNotEmpty())
            return err;
    }

    dm.addAudioCallback(this);

    // Prefer the lowest-latency backend available. ASIO (e.g. RME) gives
    // hardware-direct latency; WASAPI Exclusive bypasses the Windows mixer.
    // "Windows Audio" (shared) is the always-available high-latency fallback.
    juce::StringArray available = getAvailableBackends();
    for (const char* pref : { "ASIO", "Windows Audio (Exclusive Mode)" })
    {
        if (available.contains(pref))
        {
            if (setBackend(pref).isEmpty() && dm.getCurrentAudioDevice() != nullptr)
                break;
            // Failed — make sure we still have a working shared-mode device
            setBackend("Windows Audio");
        }
    }
    return {};
}

void AudioEngine::shutdown()
{
    sendActive.store(false);
    if (sendCallback) sendDm.removeAudioCallback(sendCallback.get());
    sendDm.closeAudioDevice();
    dm.removeAudioCallback(this);
    dm.closeAudioDevice();
    pluginChain.releaseResources();
}

// ── Device helpers ─────────────────────────────────────────────────────────────
juce::var AudioEngine::getDeviceListVar()
{
    auto* deviceType = dm.getCurrentDeviceTypeObject();
    juce::Array<juce::var> inputs, outputs;

    if (deviceType)
    {
        for (const auto& name : deviceType->getDeviceNames(true))
        {
            auto* o = new juce::DynamicObject();
            o->setProperty("name", name);
            inputs.add(juce::var(o));
        }
        for (const auto& name : deviceType->getDeviceNames(false))
        {
            auto* o = new juce::DynamicObject();
            o->setProperty("name", name);
            outputs.add(juce::var(o));
        }
    }

    // Also list available audio backend types (WASAPI, DirectSound, ASIO, …)
    juce::Array<juce::var> types;
    for (auto* deviceTypeObj : dm.getAvailableDeviceTypes())
    {
        auto* t = new juce::DynamicObject();
        t->setProperty("name", deviceTypeObj->getTypeName());
        types.add(juce::var(t));
    }

    auto* root = new juce::DynamicObject();
    root->setProperty("inputs",  inputs);
    root->setProperty("outputs", outputs);
    root->setProperty("types",   types);
    root->setProperty("backend", dm.getCurrentAudioDeviceType());
    return juce::var(root);
}

juce::String AudioEngine::getCurrentInputDevice() const
{
    return dm.getAudioDeviceSetup().inputDeviceName;
}

juce::String AudioEngine::getCurrentOutputDevice() const
{
    return dm.getAudioDeviceSetup().outputDeviceName;
}

double AudioEngine::getCurrentSampleRate() const
{
    if (auto* d = dm.getCurrentAudioDevice()) return d->getCurrentSampleRate();
    return dm.getAudioDeviceSetup().sampleRate;
}

int AudioEngine::getCurrentBufferSize() const
{
    if (auto* d = dm.getCurrentAudioDevice()) return d->getCurrentBufferSizeSamples();
    return dm.getAudioDeviceSetup().bufferSize;
}

juce::String AudioEngine::setInputDevice(const juce::String& name)
{
    auto setup = dm.getAudioDeviceSetup();
    setup.inputDeviceName          = name;
    setup.useDefaultInputChannels  = true;
    return dm.setAudioDeviceSetup(setup, true);
}

juce::String AudioEngine::setOutputDevice(const juce::String& name)
{
    auto setup = dm.getAudioDeviceSetup();
    setup.outputDeviceName          = name;
    setup.useDefaultOutputChannels  = true;
    return dm.setAudioDeviceSetup(setup, true);
}

juce::String AudioEngine::setSampleRate(double sr)
{
    auto setup = dm.getAudioDeviceSetup();
    setup.sampleRate = sr;
    return dm.setAudioDeviceSetup(setup, true);
}

juce::String AudioEngine::setBufferSize(int samples)
{
    auto setup = dm.getAudioDeviceSetup();
    setup.bufferSize = samples;
    return dm.setAudioDeviceSetup(setup, true);
}

// ── Channel selection ───────────────────────────────────────────────────────────
juce::var AudioEngine::getChannelsVar()
{
    juce::Array<juce::var> inputs, outputs;
    int inCh = -1, outCh = -1;

    if (auto* dev = dm.getCurrentAudioDevice())
    {
        for (const auto& n : dev->getInputChannelNames())  inputs.add(n);
        for (const auto& n : dev->getOutputChannelNames()) outputs.add(n);

        auto setup = dm.getAudioDeviceSetup();
        inCh  = setup.inputChannels.findNextSetBit(0);
        outCh = setup.outputChannels.findNextSetBit(0);
    }

    auto* root = new juce::DynamicObject();
    root->setProperty("inputs",       inputs);
    root->setProperty("outputs",      outputs);
    root->setProperty("inputChannel", inCh);
    root->setProperty("outputChannel", outCh);
    return juce::var(root);
}

juce::String AudioEngine::setInputChannel(int index)
{
    auto setup = dm.getAudioDeviceSetup();
    setup.useDefaultInputChannels = false;
    setup.inputChannels.clear();
    if (index >= 0) setup.inputChannels.setBit(index);   // mono mic
    return dm.setAudioDeviceSetup(setup, true);
}

juce::String AudioEngine::setOutputChannel(int index)
{
    auto setup = dm.getAudioDeviceSetup();
    setup.useDefaultOutputChannels = false;
    setup.outputChannels.clear();
    if (index >= 0)
    {
        setup.outputChannels.setBit(index);       // stereo pair
        setup.outputChannels.setBit(index + 1);
    }
    return dm.setAudioDeviceSetup(setup, true);
}

// ── Audio backend (driver type) ─────────────────────────────────────────────────
juce::String AudioEngine::getCurrentBackend() const
{
    return dm.getCurrentAudioDeviceType();
}

juce::StringArray AudioEngine::getAvailableBackends()
{
    juce::StringArray names;
    for (auto* t : dm.getAvailableDeviceTypes())
        names.add(t->getTypeName());
    return names;
}

juce::String AudioEngine::setBackend(const juce::String& typeName)
{
    if (!getAvailableBackends().contains(typeName))
        return "Audio backend not available: " + typeName;

    if (dm.getCurrentAudioDeviceType() != typeName)
        dm.setCurrentAudioDeviceType(typeName, true);

    // Open the default devices for the newly selected backend
    auto setup = dm.getAudioDeviceSetup();
    setup.useDefaultInputChannels  = true;
    setup.useDefaultOutputChannels = true;
    return dm.setAudioDeviceSetup(setup, true);
}

// ── Audio callbacks ────────────────────────────────────────────────────────────
void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* device)
{
    const double sr = device->getCurrentSampleRate();
    const int    bs = device->getCurrentBufferSizeSamples();
    processBuffer.setSize(2, bs);
    pluginChain.prepareToPlay(sr, bs);
}

void AudioEngine::audioDeviceStopped()
{
    pluginChain.releaseResources();
}

void AudioEngine::audioDeviceError(const juce::String& err)
{
    juce::Logger::writeToLog("AudioEngine error: " + err);
}

void AudioEngine::audioDeviceIOCallbackWithContext(
    const float* const* inputChannelData,  int numInputChannels,
    float* const*       outputChannelData, int numOutputChannels,
    int numSamples,
    const juce::AudioIODeviceCallbackContext&)
{
    // ── Fill process buffer from mic ─────────────────────────────────────────
    processBuffer.setSize(2, numSamples, false, false, true);
    processBuffer.clear();

    if (numInputChannels > 0 && inputChannelData && inputChannelData[0])
    {
        // Mono mic → duplicate to both channels
        processBuffer.copyFrom(0, 0, inputChannelData[0], numSamples);
        processBuffer.copyFrom(1, 0, inputChannelData[0], numSamples);
    }
    else if (numInputChannels > 1 && inputChannelData && inputChannelData[1])
    {
        // Stereo mic
        processBuffer.copyFrom(0, 0, inputChannelData[0], numSamples);
        processBuffer.copyFrom(1, 0, inputChannelData[1], numSamples);
    }

    // ── Apply input gain ──────────────────────────────────────────────────────
    processBuffer.applyGain(inputGain.load());

    // ── Measure input level (post-gain) ───────────────────────────────────────
    const float inPeak = processBuffer.getMagnitude(0, numSamples);
    inputSmooth = inputSmooth * 0.92f + inPeak * 0.08f;
    inputLevel.store(inputSmooth);

    // ── Run VST chain ────────────────────────────────────────────────────────
    midiBuffer.clear();
    pluginChain.processBlock(processBuffer, midiBuffer);

    // ── Apply output gain ─────────────────────────────────────────────────────
    processBuffer.applyGain(outputGain.load());

    // ── Measure output level (post-gain, pre-mute) ────────────────────────────
    const float outPeak = processBuffer.getMagnitude(0, numSamples);
    outputSmooth = outputSmooth * 0.92f + outPeak * 0.08f;
    outputLevel.store(outputSmooth);

    // While a chain is being (re)built, silence everything: the signal path is
    // in flux and an open mic→speaker passthrough could feed back (larsen).
    const bool master  = muted.load() || loadingChain.load() || startupMuted.load();  // kills everything
    const bool monMute = monitorMuted.load();                  // kills only the monitor

    // ── Virtual send (to apps): silenced only by master mute ──────────────────
    if (sendActive.load())
        pushSendAudio(processBuffer, numSamples, master);

    // ── Monitor output (this device): silenced by master OR monitor mute ──────
    const bool silenceMonitor = master || monMute;
    for (int ch = 0; ch < numOutputChannels; ++ch)
    {
        if (!outputChannelData[ch]) continue;
        if (silenceMonitor)
        {
            juce::FloatVectorOperations::clear(outputChannelData[ch], numSamples);
            continue;
        }
        const int src = juce::jmin(ch, processBuffer.getNumChannels() - 1);
        juce::FloatVectorOperations::copy(
            outputChannelData[ch],
            processBuffer.getReadPointer(src),
            numSamples);
    }
}
