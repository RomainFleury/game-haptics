#pragma once
//
// Registers TS_* / TSG_* natives that forward haptic events to the daemon.
//

#include "northstar.h"

namespace squirrel
{
    void OnVmCreated(ns::CSquirrelVM* vm);
    void OnVmDestroying(ns::CSquirrelVM* vm);
}
