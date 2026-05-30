#pragma once
#include <JuceHeader.h>

// Notifies when a hosted plugin's parameters change (incl. from its own editor)
struct ParamListener : juce::AudioProcessorListener
{
    std::function<void()> onChange;
    explicit ParamListener(std::function<void()> cb) : onChange(std::move(cb)) {}
    void audioProcessorParameterChanged(juce::AudioProcessor*, int, float) override { if (onChange) onChange(); }
    void audioProcessorChanged(juce::AudioProcessor*, const ChangeDetails&) override { if (onChange) onChange(); }
};

struct ChainSlot
{
    std::unique_ptr<juce::AudioPluginInstance> instance;
    juce::PluginDescription description;
    juce::String uid;           // unique slot ID
    bool enabled  = true;
    bool bypassed = false;
    std::atomic<float> level    { 0.0f };   // output level for the slot meter
    std::atomic<float> grLevel  { 0.0f };  // gain reduction 0..1 (computed per-block)
    std::atomic<float> gainLin  { 1.0f };  // per-slot post-plugin gain (linear)
    std::unique_ptr<ParamListener> listener;

    ChainSlot(std::unique_ptr<juce::AudioPluginInstance> inst,
              const juce::PluginDescription& desc)
        : instance(std::move(inst)), description(desc),
          uid(juce::Uuid().toString()) {}
};

class PluginChain
{
public:
    PluginChain() = default;

    // Called from audio thread — prepare/release
    void prepareToPlay(double sampleRate, int maxBlockSize);
    void releaseResources();

    // Real-time audio processing (audio thread only)
    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi);

    // Chain management (message thread — NOT audio thread)
    bool addPlugin(std::unique_ptr<juce::AudioPluginInstance> instance,
                   const juce::PluginDescription& desc);
    void removePlugin(int index);
    void movePlugin(int fromIndex, int toIndex);
    void setEnabled(int index, bool v);
    void setBypassed(int index, bool v);
    void setSlotGain(int index, float gainDb);

    int              numPlugins()         const;
    const ChainSlot* getSlot(int index)   const;

    // Per-slot output levels and gain-reduction values for the chain meters
    std::vector<float> getSlotLevels()  const;
    std::vector<float> getSlotGrLevels() const;

    // Bypass entire chain
    void setBypassAll(bool v)  { bypassAll.store(v); }
    bool isBypassAll()         const { return bypassAll.load(); }

    // Parameter access (message thread)
    void  setParameter(int slotIndex, int paramIndex, float normalised);
    float getParameter(int slotIndex, int paramIndex) const;
    void  setPluginState(int slotIndex, const juce::String& base64State);

    // Serialise the chain as a juce::var array
    juce::var toVar() const;

    // Called whenever a hosted plugin parameter changes (set by AudioEngine)
    std::function<void()> onParameterChanged;

private:
    // Protected by chainLock; written on message thread, read on audio thread
    juce::OwnedArray<ChainSlot>  slots;
    mutable juce::ReadWriteLock  chainLock;

    std::atomic<bool> bypassAll { false };

    double currentSampleRate = 48000.0;
    int    currentBlockSize  = 512;

    // Scratch buffer for channel-count adaptation
    juce::AudioBuffer<float> scratch;
};
