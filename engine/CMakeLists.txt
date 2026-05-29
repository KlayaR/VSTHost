cmake_minimum_required(VERSION 3.22)
project(VSTHostEngine VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── ASIO SDK (low-latency Windows audio) ──────────────────────────────────────
# Downloaded automatically from Steinberg. Set -DVSTHOST_ASIO=OFF to disable.
option(VSTHOST_ASIO "Enable ASIO support (auto-downloads SDK)" ON)

include(FetchContent)

if(VSTHOST_ASIO AND WIN32)
    FetchContent_Declare(
        asiosdk
        URL https://download.steinberg.net/sdk_downloads/asiosdk_2.3.3_2019-06-14.zip
    )
    FetchContent_MakeAvailable(asiosdk)
    # The SDK extracts to asiosdk-src/common (contains asio.h, iasiodrv.h, …)
    if(EXISTS "${asiosdk_SOURCE_DIR}/common/asio.h")
        set(VSTHOST_ASIO_PATH "${asiosdk_SOURCE_DIR}/common")
        message(STATUS "ASIO SDK ready at ${VSTHOST_ASIO_PATH}")
    else()
        message(WARNING "ASIO SDK download did not contain common/asio.h — disabling ASIO")
        set(VSTHOST_ASIO OFF)
    endif()
else()
    set(VSTHOST_ASIO OFF)
endif()

# ── Fetch JUCE ────────────────────────────────────────────────────────────────
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
)
FetchContent_MakeAvailable(JUCE)

# ── Executable ────────────────────────────────────────────────────────────────
juce_add_console_app(VSTHostEngine PRODUCT_NAME "VSTHostEngine")
juce_generate_juce_header(VSTHostEngine)

target_sources(VSTHostEngine PRIVATE
    src/Main.cpp
    src/AudioEngine.cpp
    src/PluginChain.cpp
    src/PluginScanner.cpp
    src/PresetManager.cpp
    src/IPCBridge.cpp
)

# ── Compile definitions ───────────────────────────────────────────────────────
target_compile_definitions(VSTHostEngine PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_AU=0
    JUCE_PLUGINHOST_LADSPA=0
    $<$<BOOL:${VSTHOST_ASIO}>:JUCE_ASIO=1>
)

# ASIO headers (iasiodrv.h, asio.h, …) must be on the include path when enabled
if(VSTHOST_ASIO)
    target_include_directories(VSTHostEngine PRIVATE "${VSTHOST_ASIO_PATH}")
endif()

# ── Link libraries ────────────────────────────────────────────────────────────
target_link_libraries(VSTHostEngine PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_core
    juce::juce_data_structures
    juce::juce_events
    juce::juce_graphics
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)

if(WIN32)
    target_link_libraries(VSTHostEngine PRIVATE winmm ole32 oleaut32 comdlg32 ws2_32 imm32 version)
endif()

message(STATUS "")
message(STATUS "VSTHostEngine configuration:")
message(STATUS "  ASIO support : ${VSTHOST_ASIO}")
message(STATUS "  VST3 support : ON (always)")
message(STATUS "")
