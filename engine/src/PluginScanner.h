#pragma once
#include <JuceHeader.h>
#include <functional>

// Callbacks fired on the message thread
using ScanProgressCB = std::function<void(const juce::String& currentPlugin, float progress)>;
using ScanDoneCB     = std::function<void(const juce::var& pluginListVar)>;

class PluginScanner
{
public:
    PluginScanner();

    // Asynchronous scan — callbacks delivered on message thread
    void scan(const juce::StringArray& paths,
              ScanProgressCB onProgress,
              ScanDoneCB     onDone);

    // Cancel a running scan
    void cancelScan();

    // Get the format manager (needed for loading plugins)
    juce::AudioPluginFormatManager& getFormatManager() { return formatManager; }

    // Look up a description by file path + format name
    bool findDescription(const juce::String& fileOrIdentifier,
                         const juce::String& format,
                         juce::PluginDescription& outDesc) const;

    // Re-derive a full plugin description straight from the file (robust for
    // VST3 bundles whose cached identifier may not round-trip cleanly).
    bool describeFile(const juce::String& fileOrIdentifier,
                      juce::PluginDescription& outDesc);

    // Like describeFile but disambiguates by unique id — required for shell
    // plugins (e.g. Waves WaveShell) that pack many plugins in one file.
    bool describePlugin(const juce::String& fileOrIdentifier,
                        const juce::String& uid,
                        juce::PluginDescription& outDesc);

    // Serialise the known plugin list as a juce::var array
    juce::var knownPluginsToVar() const;

    // Plugins that crashed during a previous scan and are now skipped.
    juce::StringArray blacklistedFiles() const { return knownPlugins.getBlacklistedFiles(); }

    // Forget the blacklist + dead-man's-pedal so a rescan retries everything.
    void clearBlacklist();

    // Location of the dead-man's-pedal file (records the plugin currently being
    // scanned, so that if the process crashes we know which one to blacklist).
    static juce::File deadMansPedalFile();

    // Persist / restore the scanned plugin list so that loading a preset at
    // startup doesn't have to re-enumerate every plugin file from disk (which
    // is catastrophically slow for shell plugins like Waves WaveShell).
    void saveKnownPlugins() const;
    void loadKnownPlugins();
    static juce::File knownPluginsFile();

private:
    juce::AudioPluginFormatManager formatManager;
    juce::KnownPluginList          knownPlugins;

    // Scanner runs on a background thread
    struct ScanThread : public juce::Thread
    {
        ScanThread(PluginScanner& owner,
                   const juce::StringArray& paths,
                   ScanProgressCB onProgress,
                   ScanDoneCB onDone)
            : juce::Thread("PluginScanner"),
              owner(owner), paths(paths),
              onProgress(std::move(onProgress)),
              onDone(std::move(onDone)) {}

        void run() override;

        PluginScanner&  owner;
        juce::StringArray paths;
        ScanProgressCB  onProgress;
        ScanDoneCB      onDone;
    };

    std::unique_ptr<ScanThread> scanThread;
};
