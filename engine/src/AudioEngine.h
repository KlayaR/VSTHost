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

    // ── Input / output gain (dB) ──────────────────────────────────────────────
    void setInputGainDb (float db) { inputGain.store (juce::Decibels::decibelsToGain(db)); }
    void setOutputGainDb(float db) { outputGain.store(juce::Decibels::decibelsToGain(db)); }

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
    juce::AudioDeviceManager dm;
    PluginChain              pluginChain;
    PluginScanner            pluginScanner;

    std::atomic<float> inputLevel  { 0.0f };
    std::atomic<float> outputLevel { 0.0f };
    std::atomic<bool>  paramDirty  { false };
    std::atomic<float> inputGain   { 1.0f };
    std::atomic<float> outputGain  { 1.0f };
    float inputSmooth  = 0.0f;
    float outputSmooth = 0.0f;

    juce::AudioBuffer<float> processBuffer;
    juce::MidiBuffer         midiBuffer;
};
