#include "IPCBridge.h"
#include <iostream>

IPCBridge::IPCBridge() : juce::Thread("IPCBridge") {}

IPCBridge::~IPCBridge()
{
    signalThreadShouldExit();
    stopThread(2000);
}

void IPCBridge::setCommandHandler(CommandHandler handler)
{
    commandHandler = std::move(handler);
}

void IPCBridge::sendEvent(juce::DynamicObject* obj)
{
    juce::var v(obj);
    sendEvent(juce::JSON::toString(v, true));
}

void IPCBridge::sendEvent(const juce::String& jsonLine)
{
    juce::ScopedLock sl(writeLock);
    std::cout << jsonLine.toStdString() << "\n";
    std::cout.flush();
}

void IPCBridge::run()
{
    std::string line;
    while (!threadShouldExit())
    {
        if (!std::getline(std::cin, line))
            break; // stdin closed → Electron exited

        juce::String jline(line.c_str());
        jline = jline.trim();
        if (jline.isEmpty()) continue;

        auto result = juce::JSON::parse(jline);
        if (result.isObject() && commandHandler)
        {
            // Dispatch on the message thread so JUCE audio objects are safe to call
            juce::var captured = result;
            juce::MessageManager::callAsync([this, captured]()
            {
                if (commandHandler) commandHandler(captured);
            });
        }
    }

    // stdin closed — ask JUCE to quit
    juce::MessageManager::callAsync([]() {
        juce::JUCEApplicationBase::quit();
    });
}
