#pragma once
#include <JuceHeader.h>
#include <functional>

// Newline-delimited JSON over stdin/stdout.
// Commands arrive from Electron on stdin; events are written to stdout.
class IPCBridge : public juce::Thread
{
public:
    using CommandHandler = std::function<void(const juce::var&)>;

    IPCBridge();
    ~IPCBridge() override;

    void setCommandHandler(CommandHandler handler);

    // Send an event object to Electron (thread-safe)
    void sendEvent(juce::DynamicObject* obj);
    void sendEvent(const juce::String& jsonLine);

    // juce::Thread
    void run() override;

private:
    CommandHandler      commandHandler;
    juce::CriticalSection writeLock;
};
