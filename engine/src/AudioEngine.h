#pragma once
#include <JuceHeader.h>
#include "PluginChain.h"
#include "PluginScanner.h"

class AudioEngine : public juce::AudioIODeviceCallback
{
public:
    AudioEngine();
    ~AudioEngine() override;

    // Returns empty string on success, error description on failure
    juce::String initialise();
    void shutdown();

    // ── Device control (message thread) ──────────────────────────────────────
    juce::var  getDeviceListVar();
    juce::String getCurrentInputDevice()  const;
    juce::String getCurrentOutputDevice() const;
    double       getCurrentSampleRate()   const;
    int          getCurrentBufferSize()   const;

    juce::String setInputDevice (const juce::String& name);
    juce::String setOutputDevice(const juce::String& name);
    juce::String setSampleRate  (double sr);
    juce::String setBufferSize  (int samples);

    // ── Channel selection within the current device (ADAT/Analog under ASIO) ──
    juce::var    getChannelsVar();             // { inputs:[], outputs:[], inputChannel, outputChannel }
    juce::String setInputChannel (int index);  // mono mic channel
    juce::String setOutputChannel(int index);  // stereo pair starting at index

    // ── Audio backend / driver type (ASIO, WASAPI shared/exclusive, …) ────────
    juce::String getCurrentBackend() const;
    juce::String setBackend(const juce::String& typeName);
    juce::StringArray getAvailableBackends();

    // ── Levels (safe to call from any thread) ────────────────────────────────
    float getInputLevel()  const { return inputLevel.load();  }
    float getOutputLevel() const { return outputLevel.load(); }

    // ── Parameter-change dirty flag (set when any plugin param changes) ───────
    bool consumeParamDirty() { return paramDirty.exchange(false); }
    void clearParamDirty()   { paramDirty.store(false); }

    // True while a chain is being (re)built programmatically. While set, the
    // param-changed notifications triggered by restoring plugin state must NOT
    // be reported to the UI as user edits.
    void setLoadingChain(bool v) { loadingChain.store(v); }
    bool isLoadingChain() const  { return loadingChain.load(); }

    // Muted from launch until the UI's loading screen is dismissed, so the
    // empty-chain mic→output passthrough can't feed back during startup.
    void clearStartupMute() { startupMuted.store(false); }

    // ── Input / output gain (dB) ──────────────────────────────────────────────
    void setInputGainDb (float db) { inputGain.store (juce::Decibels::decibelsToGain(db)); }
    void setOutputGainDb(float db) { outputGain.store(juce::Decibels::decibelsToGain(db)); }

    // ── Mute / monitor ─────────────────────────────────────────────────────────
    // muted        = master mute (kills monitor + virtual send)
    // monitorMuted = silence only the monitor output (apps still get the send)
    void setMuted(bool m)        { muted.store(m); }
    bool isMuted() const         { return muted.load(); }
    void setMonitorMuted(bool m) { monitorMuted.store(m); }
    bool isMonitorMuted() const  { return monitorMuted.load(); }

    // ── Virtual output send (a 2nd output device for Discord/OBS) ─────────────
    juce::StringArray getOutputDevicesFor(const juce::String& backendType);
    juce::String      setVirtualOutput(const juce::String& deviceName); // "" = off
    juce::String      getVirtualOutput() const { return virtualOutName; }
    void pullSendAudio(float* const* out, int numOut, int numSamples);  // send-device callback

    // ── CPU usage 0..1 (from the audio device) ────────────────────────────────
    double getCpuUsage() { return dm.getCpuUsage(); }

    // ── Accessors ─────────────────────────────────────────────────────────────
    PluginChain&   chain()   { return pluginChain;   }
    PluginScanner& scanner() { return pluginScanner; }
    juce::AudioDeviceManager& deviceManager() { return dm; }

    // ── juce::AudioIODeviceCallback ───────────────────────────────────────────
    void audioDeviceIOCallbackWithContext(
        const float* const* inputChannelData,  int numInputChannels,
        float* const*       outputChannelData, int numOutputChannels,
        int numSamples,
        const juce::AudioIODeviceCallbackContext&) override;

    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;
    void audioDeviceError(const juce::String& errorMessage) override;

private:
    void pushSendAudio(const juce::AudioBuffer<float>& buf, int numSamples, bool silence);

    juce::AudioDeviceManager dm;
    PluginChain              pluginChain;
    PluginScanner            pluginScanner;

    std::atomic<float> inputLevel  { 0.0f };
    std::atomic<float> outputLevel { 0.0f };
    std::atomic<bool>  paramDirty   { false };
    std::atomic<bool>  loadingChain { false };
    std::atomic<bool>  startupMuted { true };
    std::atomic<float> inputGain   { 1.0f };
    std::atomic<float> outputGain  { 1.0f };
    std::atomic<bool>  muted       { false };
    std::atomic<bool>  monitorMuted{ false };
    float inputSmooth  = 0.0f;
    float outputSmooth = 0.0f;

    juce::AudioBuffer<float> processBuffer;
    juce::MidiBuffer         midiBuffer;

    // ── Virtual output send: 2nd device fed by a lock-free FIFO ───────────────
    juce::AudioDeviceManager       sendDm;
    std::unique_ptr<juce::AudioIODeviceCallback> sendCallback;
    juce::AbstractFifo             sendFifo { 1 << 15 };
    juce::AudioBuffer<float>       sendRing;          // 2 x (1<<15)
    std::atomic<bool>              sendActive { false };
    juce::String                   virtualOutName;
};
