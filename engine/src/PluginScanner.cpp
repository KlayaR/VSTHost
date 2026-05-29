#include "PluginScanner.h"

PluginScanner::PluginScanner()
{
    formatManager.addDefaultFormats(); // VST3 always; VST2 if JUCE_PLUGINHOST_VST=1
}

void PluginScanner::scan(const juce::StringArray& paths,
                          ScanProgressCB onProgress,
                          ScanDoneCB     onDone)
{
    cancelScan();
    scanThread = std::make_unique<ScanThread>(*this, paths,
                                              std::move(onProgress),
                                              std::move(onDone));
    scanThread->startThread(juce::Thread::Priority::background);
}

void PluginScanner::cancelScan()
{
    if (scanThread && scanThread->isThreadRunning())
        scanThread->stopThread(3000);
    scanThread.reset();
}

bool PluginScanner::findDescription(const juce::String& fileOrId,
                                     const juce::String& format,
                                     juce::PluginDescription& out) const
{
    for (const auto& desc : knownPlugins.getTypes())
    {
        if (desc.fileOrIdentifier == fileOrId && desc.pluginFormatName == format)
        {
            out = desc;
            return true;
        }
    }
    return false;
}

bool PluginScanner::describeFile(const juce::String& fileOrId, juce::PluginDescription& out)
{
    // First, prefer a description we already have from the scan.
    for (const auto& desc : knownPlugins.getTypes())
        if (desc.fileOrIdentifier == fileOrId)
        {
            out = desc;
            return true;
        }

    // Otherwise ask each format to enumerate the file directly.
    for (int i = 0; i < formatManager.getNumFormats(); ++i)
    {
        auto* format = formatManager.getFormat(i);
        if (format->fileMightContainThisPluginType(fileOrId))
        {
            juce::OwnedArray<juce::PluginDescription> found;
            knownPlugins.scanAndAddFile(fileOrId, true, found, *format);
            if (found.size() > 0)
            {
                out = *found[0];
                return true;
            }
        }
    }
    return false;
}

bool PluginScanner::describePlugin(const juce::String& fileOrId, const juce::String& uid,
                                   juce::PluginDescription& out)
{
    if (uid.isEmpty())
        return describeFile(fileOrId, out);

    // 1) Already-scanned types matching the unique id
    for (const auto& desc : knownPlugins.getTypes())
        if (desc.createIdentifierString() == uid)
        {
            out = desc;
            return true;
        }

    // 2) Scan the file directly and pick the sub-plugin with the matching id
    for (int i = 0; i < formatManager.getNumFormats(); ++i)
    {
        auto* format = formatManager.getFormat(i);
        if (format->fileMightContainThisPluginType(fileOrId))
        {
            juce::OwnedArray<juce::PluginDescription> found;
            knownPlugins.scanAndAddFile(fileOrId, true, found, *format);
            for (auto* d : found)
                if (d->createIdentifierString() == uid)
                {
                    out = *d;
                    return true;
                }
        }
    }

    // 3) Fall back to first-in-file
    return describeFile(fileOrId, out);
}

juce::var PluginScanner::knownPluginsToVar() const
{
    juce::Array<juce::var> arr;
    for (const auto& desc : knownPlugins.getTypes())
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("name",         desc.name);
        obj->setProperty("manufacturer", desc.manufacturerName);
        obj->setProperty("format",       desc.pluginFormatName);
        obj->setProperty("category",     desc.category);
        obj->setProperty("file",         desc.fileOrIdentifier);
        obj->setProperty("uid",          desc.createIdentifierString());
        obj->setProperty("numInputs",    desc.numInputChannels);
        obj->setProperty("numOutputs",   desc.numOutputChannels);
        obj->setProperty("isInstrument", desc.isInstrument);
        arr.add(juce::var(obj));
    }
    return juce::var(arr);
}

// ─── ScanThread ───────────────────────────────────────────────────────────────
void PluginScanner::ScanThread::run()
{
    owner.knownPlugins.clear();

    juce::File deadMansPedal(juce::File::getSpecialLocation(
        juce::File::userApplicationDataDirectory)
        .getChildFile("VSTHost/deadmanspedal.txt"));

    for (int fi = 0; fi < owner.formatManager.getNumFormats(); ++fi)
    {
        if (threadShouldExit()) break;
        auto* format = owner.formatManager.getFormat(fi);

        // Start from this format's default system locations, then add user paths
        juce::FileSearchPath searchPaths = format->getDefaultLocationsToSearch();
        for (const auto& p : paths)
        {
            juce::File dir(p);
            if (dir.isDirectory())
                searchPaths.addIfNotAlreadyThere(dir);
        }

        juce::PluginDirectoryScanner scanner(
            owner.knownPlugins, *format,
            searchPaths, true, deadMansPedal, true);

        juce::String currentPlugin;
        while (!threadShouldExit() && scanner.scanNextFile(true, currentPlugin))
        {
            const float progress = scanner.getProgress();
            if (onProgress)
            {
                juce::MessageManager::callAsync([p = onProgress, currentPlugin, progress]()
                {
                    p(currentPlugin, progress);
                });
            }
        }
    }

    // Notify done on message thread
    juce::var result = owner.knownPluginsToVar();
    juce::MessageManager::callAsync([d = onDone, result]()
    {
        if (d) d(result);
    });
}
