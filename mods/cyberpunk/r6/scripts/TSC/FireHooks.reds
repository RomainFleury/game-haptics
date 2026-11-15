// Own-weapon fire → cyberpunk_event gunfire / solenoid mapping.
// Hook pattern: ShootEvents.OnEnter (redmodding wiki / OWO-style combat surface).

public func TSC_ClassifyWeapon(weapon: ref<WeaponObject>) -> String {
  if !IsDefined(weapon) {
    return "gun_fire";
  }

  let itemType: gamedataItemType = WeaponObject.GetWeaponType(weapon);

  if Equals(itemType, gamedataItemType.Wea_Shotgun) || Equals(itemType, gamedataItemType.Wea_ShotgunDual) {
    return "shotgun_fire";
  }
  if Equals(itemType, gamedataItemType.Wea_SniperRifle) {
    return "sniper_fire";
  }
  if Equals(itemType, gamedataItemType.Wea_SMG) {
    return "smg_fire";
  }
  if Equals(itemType, gamedataItemType.Wea_AssaultRifle)
    || Equals(itemType, gamedataItemType.Wea_PrecisionRifle)
    || Equals(itemType, gamedataItemType.Wea_LMG)
    || Equals(itemType, gamedataItemType.Wea_HeavyMachineGun) {
    return "rifle_fire";
  }
  // Handgun / revolver / default
  return "gun_fire";
}

public func TSC_WeaponKey(eventName: String) -> String {
  if Equals(eventName, "shotgun_fire") {
    return "shotgun";
  }
  if Equals(eventName, "sniper_fire") || Equals(eventName, "rifle_fire") {
    return "rifle";
  }
  return "pistol";
}

@wrapMethod(ShootEvents)
protected final func OnEnter(stateContext: ref<StateContext>, scriptInterface: ref<StateGameScriptInterface>) -> Void {
  wrappedMethod(stateContext, scriptInterface);

  let player: ref<GameObject> = scriptInterface.executionOwner;
  if !IsDefined(player) || !player.IsPlayer() {
    return;
  }

  let weapon: ref<WeaponObject> = ScriptedPuppet.GetActiveWeapon(player);
  let eventName: String = TSC_ClassifyWeapon(weapon);
  let weaponKey: String = TSC_WeaponKey(eventName);
  TSC_Kick(eventName, weaponKey, "right");
}
