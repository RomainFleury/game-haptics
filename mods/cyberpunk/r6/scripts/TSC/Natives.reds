// Native declarations implemented by TSC_Cyberpunk.dll (RED4ext).
// Keep signatures in sync with src/natives.cpp.

public static native func TSC_Play(eventName: String) -> Void
public static native func TSC_Kick(eventName: String, weapon: String, hand: String) -> Void
public static native func TSC_Hit(angle: Float, intensity: Float) -> Void
