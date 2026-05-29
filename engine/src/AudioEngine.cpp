#include "AudioEngine.h"

AudioEngine::AudioEngine()
{
    pluginChain.onParameterChanged = [this] { paramDirty.store(true); };
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

    // ── Measure input level ──────────────────────────────────────────────────
    const float inPeak = processBuffer.getMagnitude(0, numSamples);
    inputSmooth = inputSmooth * 0.92f + inPeak * 0.08f;
    inputLevel.store(inputSmooth);

    // ── Run VST chain ────────────────────────────────────────────────────────
    midiBuffer.clear();
    pluginChain.processBlock(processBuffer, midiBuffer);

    // ── Measure output level ─────────────────────────────────────────────────
    const float outPeak = processBuffer.getMagnitude(0, numSamples);
    outputSmooth = outputSmooth * 0.92f + outPeak * 0.08f;
    outputLevel.store(outputSmooth);

    // ── Write to outputs ─────────────────────────────────────────────────────
    for (int ch = 0; ch < numOutputChannels; ++ch)
    {
        if (!outputChannelData[ch]) continue;
        const int src = juce::jmin(ch, processBuffer.getNumChannels() - 1);
        juce::FloatVectorOperations::copy(
            outputChannelData[ch],
            processBuffer.getReadPointer(src),
            numSamples);
    }
}
