#include "PluginChain.h"

void PluginChain::prepareToPlay(double sr, int blockSize)
{
    currentSampleRate = sr;
    currentBlockSize  = blockSize;
    scratch.setSize(2, blockSize);

    juce::ScopedReadLock rl(chainLock);
    for (auto* slot : slots)
        if (slot && slot->instance)
            slot->instance->prepareToPlay(sr, blockSize);
}

void PluginChain::releaseResources()
{
    juce::ScopedReadLock rl(chainLock);
    for (auto* slot : slots)
        if (slot && slot->instance)
            slot->instance->releaseResources();
}

void PluginChain::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    if (bypassAll.load()) return;

    juce::ScopedReadLock rl(chainLock);

    for (auto* slot : slots)
    {
        if (!slot || !slot->instance || !slot->enabled || slot->bypassed)
        {
            // Still report the passing signal level at this stage
            if (slot) slot->level.store(slot->level.load() * 0.8f + buffer.getMagnitude(0, buffer.getNumSamples()) * 0.2f);
            continue;
        }

        auto& proc = *slot->instance;
        const int plugIns  = proc.getTotalNumInputChannels();
        const int plugOuts = proc.getTotalNumOutputChannels();
        const int needed   = juce::jmax(plugIns, plugOuts);

        if (buffer.getNumChannels() == needed)
        {
            proc.processBlock(buffer, midi);
        }
        else
        {
            // Adapt channel count via scratch buffer
            scratch.setSize(needed, buffer.getNumSamples(), false, false, true);
            scratch.clear();

            for (int ch = 0; ch < juce::jmin(buffer.getNumChannels(), needed); ++ch)
                scratch.copyFrom(ch, 0, buffer, ch, 0, buffer.getNumSamples());

            proc.processBlock(scratch, midi);

            for (int ch = 0; ch < juce::jmin(buffer.getNumChannels(), needed); ++ch)
                buffer.copyFrom(ch, 0, scratch, ch, 0, buffer.getNumSamples());
        }

        // Per-slot post-plugin gain
        const float g = slot->gainLin.load();
        if (std::abs(g - 1.0f) > 0.001f) buffer.applyGain(g);

        // Slot output level for the meter (post-gain)
        slot->level.store(slot->level.load() * 0.8f + buffer.getMagnitude(0, buffer.getNumSamples()) * 0.2f);
    }
}

void PluginChain::setSlotGain(int index, float gainDb)
{
    juce::ScopedReadLock rl(chainLock);
    if (juce::isPositiveAndBelow(index, slots.size()))
        slots[index]->gainLin.store(juce::Decibels::decibelsToGain(gainDb));
}

bool PluginChain::addPlugin(std::unique_ptr<juce::AudioPluginInstance> inst,
                             const juce::PluginDescription& desc)
{
    if (!inst) return false;
    inst->prepareToPlay(currentSampleRate, currentBlockSize);

    auto* slot = new ChainSlot(std::move(inst), desc);
    slot->listener = std::make_unique<ParamListener>([this] { if (onParameterChanged) onParameterChanged(); });
    slot->instance->addListener(slot->listener.get());

    juce::ScopedWriteLock wl(chainLock);
    slots.add(slot);
    return true;
}

void PluginChain::removePlugin(int index)
{
    juce::ScopedWriteLock wl(chainLock);
    if (juce::isPositiveAndBelow(index, slots.size()))
    {
        slots[index]->instance->releaseResources();
        slots.remove(index);
    }
}

void PluginChain::movePlugin(int from, int to)
{
    juce::ScopedWriteLock wl(chainLock);
    if (juce::isPositiveAndBelow(from, slots.size()) &&
        juce::isPositiveAndBelow(to,   slots.size()))
        slots.move(from, to);
}

void PluginChain::setEnabled (int i, bool v)
{
    juce::ScopedReadLock rl(chainLock);
    if (juce::isPositiveAndBelow(i, slots.size())) slots[i]->enabled  = v;
}

void PluginChain::setBypassed(int i, bool v)
{
    juce::ScopedReadLock rl(chainLock);
    if (juce::isPositiveAndBelow(i, slots.size())) slots[i]->bypassed = v;
}

int PluginChain::numPlugins() const
{
    juce::ScopedReadLock rl(chainLock);
    return slots.size();
}

const ChainSlot* PluginChain::getSlot(int index) const
{
    juce::ScopedReadLock rl(chainLock);
    return juce::isPositiveAndBelow(index, slots.size()) ? slots[index] : nullptr;
}

std::vector<float> PluginChain::getSlotLevels() const
{
    juce::ScopedReadLock rl(chainLock);
    std::vector<float> out;
    out.reserve((size_t) slots.size());
    for (const auto* s : slots)
        out.push_back(s ? s->level.load() : 0.0f);
    return out;
}

void PluginChain::setParameter(int slotIdx, int paramIdx, float value)
{
    juce::ScopedReadLock rl(chainLock);
    if (juce::isPositiveAndBelow(slotIdx, slots.size()))
    {
        auto& params = slots[slotIdx]->instance->getParameters();
        if (juce::isPositiveAndBelow(paramIdx, params.size()))
            params[paramIdx]->setValue(value);
    }
}

float PluginChain::getParameter(int slotIdx, int paramIdx) const
{
    juce::ScopedReadLock rl(chainLock);
    if (juce::isPositiveAndBelow(slotIdx, slots.size()))
    {
        auto& params = slots[slotIdx]->instance->getParameters();
        if (juce::isPositiveAndBelow(paramIdx, params.size()))
            return params[paramIdx]->getValue();
    }
    return 0.0f;
}

juce::var PluginChain::toVar() const
{
    juce::ScopedReadLock rl(chainLock);
    juce::Array<juce::var> arr;

    for (const auto* slot : slots)
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("uid",          slot->uid);
        obj->setProperty("name",         slot->description.name);
        obj->setProperty("manufacturer", slot->description.manufacturerName);
        obj->setProperty("format",       slot->description.pluginFormatName);
        obj->setProperty("category",     slot->description.category);
        obj->setProperty("enabled",      slot->enabled);
        obj->setProperty("bypassed",     slot->bypassed);
        obj->setProperty("gainDb",       juce::Decibels::gainToDecibels(slot->gainLin.load()));
        obj->setProperty("latency",      slot->instance->getLatencySamples());
        obj->setProperty("file",         slot->description.fileOrIdentifier);
        obj->setProperty("identifier",   slot->description.createIdentifierString());

        // Full plugin state (captures everything, e.g. FabFilter curves) as base64
        juce::MemoryBlock stateBlock;
        slot->instance->getStateInformation(stateBlock);
        obj->setProperty("state", stateBlock.toBase64Encoding());

        juce::Array<juce::var> params;
        for (auto* p : slot->instance->getParameters())
        {
            auto* po = new juce::DynamicObject();
            po->setProperty("index",  p->getParameterIndex());
            po->setProperty("name",   p->getName(128));
            po->setProperty("value",  p->getValue());
            po->setProperty("label",  p->getLabel());
            po->setProperty("text",   p->getCurrentValueAsText());
            params.add(juce::var(po));
        }
        obj->setProperty("parameters", params);

        arr.add(juce::var(obj));
    }

    return juce::var(arr);
}
