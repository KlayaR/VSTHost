#include "PresetManager.h"

PresetManager::PresetManager() = default;

juce::File PresetManager::getPresetsFolder() const
{
    // Prefer the inherited %APPDATA% env var — reliable when the engine is
    // spawned headless by the Tauri host. Fall back to the JUCE special
    // location (which can resolve oddly in a non-interactive process).
    juce::File base;
    if (auto* appdata = std::getenv("APPDATA"))
    {
        juce::File f(juce::String::fromUTF8(appdata));
        if (f.isDirectory())
            base = f;
    }
    if (base == juce::File())
        base = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);

    auto folder = base.getChildFile("VSTHost").getChildFile("Presets");
    folder.createDirectory();
    return folder;
}

bool PresetManager::savePreset(const juce::String& name, const juce::var& chainVar,
                                float inputGain, float outputGain)
{
    auto* root = new juce::DynamicObject();
    root->setProperty("name",       name);
    root->setProperty("version",    1);
    root->setProperty("inputGain",  inputGain);
    root->setProperty("outputGain", outputGain);
    root->setProperty("chain",      chainVar);

    juce::var v(root);
    juce::String json = juce::JSON::toString(v, false);

    // Sanitise filename
    juce::String filename = name.replaceCharacters("/\\:*?\"<>|", "_________") + ".json";
    auto file = getPresetsFolder().getChildFile(filename);
    return file.replaceWithText(json);
}

juce::var PresetManager::loadPreset(const juce::String& name) const
{
    juce::String filename = name.replaceCharacters("/\\:*?\"<>|", "_________") + ".json";
    auto file = getPresetsFolder().getChildFile(filename);
    if (!file.existsAsFile()) return {};
    return juce::JSON::parse(file.loadFileAsString());
}

bool PresetManager::deletePreset(const juce::String& name)
{
    juce::String filename = name.replaceCharacters("/\\:*?\"<>|", "_________") + ".json";
    return getPresetsFolder().getChildFile(filename).deleteFile();
}

juce::var PresetManager::listPresets() const
{
    juce::Array<juce::var> arr;
    for (const auto& f : getPresetsFolder().findChildFiles(juce::File::findFiles, false, "*.json"))
    {
        auto data = juce::JSON::parse(f.loadFileAsString());
        if (!data.isObject()) continue;

        auto* o = new juce::DynamicObject();
        o->setProperty("name", data["name"].toString().isNotEmpty()
                                   ? data["name"].toString()
                                   : f.getFileNameWithoutExtension());
        o->setProperty("file", f.getFullPathName());
        o->setProperty("date", f.getLastModificationTime().toString(true, false));
        arr.add(juce::var(o));
    }
    return juce::var(arr);
}
