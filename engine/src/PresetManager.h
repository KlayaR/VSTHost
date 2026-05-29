#pragma once
#include <JuceHeader.h>

class PresetManager
{
public:
    PresetManager();

    // Returns the path to the preset folder (created if absent)
    juce::File getPresetsFolder() const;

    // Save/load a preset JSON file
    bool        savePreset  (const juce::String& name, const juce::var& chainVar,
                             float inputGain, float outputGain);
    juce::var   loadPreset  (const juce::String& name) const;
    bool        deletePreset(const juce::String& name);

    // Returns array of {name, path, date} objects
    juce::var   listPresets() const;
};
