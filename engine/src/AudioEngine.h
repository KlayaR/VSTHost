#pragma once
#include <JuceHeader.h>
#include "PluginChain.h"
#include "PluginScanner.h"

// ── Brick-wall peak limiter ───────────────────────────────────────────────────
// Sits at the very end of the signal path (after plugin chain + output gain).
// Designed for voice/comms: fast attack so peaks can't clip Discord's encoder,
// smooth release so gain pumping is inaudible on speech.
struct OutputLimiter
{
    // ── Controls (atomics — safe to write from any thread) ────────────────────
    std::atomic<bool>  enabled     { true };
    std::atomic<float> thresholdDb { -3.0f };  // default: 3 dB of headroom

    // ── Metering: 0 = no reduction, 1 = fully limited ────────────────────────
    std::atomic<float> grSmoothed  { 0.0f };

    // ── State ─────────────────────────────────────────────────────────────────
    float gainEnv       { 1.0f };   // running gain envelope (linear)
    float attackCoeff   { 0.0f };
    float releaseCoeff  { 0.0f };

    void prepare(double sampleRate)
    {
        // 0.1 ms attack  — catches peaks before they reach the encoder
        attackCoeff  = std::exp(-1.0f / (float(sampleRate) * 0.0001f));
        // 80 ms release  — natural, no audible pumping on voice
        releaseCoeff = std::exp(-1.0f / (float(sampleRate) * 0.080f));
        gainEnv      = 1.0f;
        grSmoothed.store(0.0f);
    }

    void process(juce::AudioBuffer<float>& buffer)
    {
        if (!enabled.load()) { grSmoothed.store(0.0f); return; }

        const float thresh = juce::Decibels::decibelsToGain(thresholdDb.load());
        const int   nc     = buffer.getNumChannels();
        const int   ns     = buffer.getNumSamples();
        float       ge     = gainEnv;

        for (int s = 0; s < ns; ++s)
        {
            // True peak across all channels
            float peak = 0.0f;
            for (int ch = 0; ch < nc; ++ch)
                peak = juce::jmax(peak, std::abs(buffer.getSample(ch, s)));

            // Desired gain: clamp to threshold
            float desired = (peak > thresh && peak > 1e-6f)
                          ? thresh / peak
                          : 1.0f;
            desired = juce::jmin(desired, 1.0f);

            // Attack when gain drops, release when it recovers
            ge = desired < ge
               ? ge * attackCoeff  + desired * (1.0f - attackCoeff)   // fast attack
               : ge * releaseCoeff + desired * (1.0f - releaseCoeff);  // slow release
            ge = juce::jmin(ge, 1.0f);

            for (int ch = 0; ch < nc; ++ch)
                buffer.setSample(ch, s, buffer.getSample(ch, s) * ge);
        }

        gainEnv = ge;
        // GR amount 0..1 (positive = reducing)
        grSmoothed.store(1.0f - ge);
    }
};

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
    float getLimiterGr()   const { return limiter.grSmoothed.load(); }

    // ── Output limiter controls ───────────────────────────────────────────────
    void setLimiterEnabled  (bool  v)  { limiter.enabled.store(v); }
    void setLimiterThreshold(float db) { limiter.thresholdDb.store(db); }
    bool  getLimiterEnabled()   const  { return limiter.enabled.load(); }
    float getLimiterThreshold() const  { return limiter.thresholdDb.load(); }

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
    OutputLimiter limiter;

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
