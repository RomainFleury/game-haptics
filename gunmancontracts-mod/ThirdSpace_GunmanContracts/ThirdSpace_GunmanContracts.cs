using HarmonyLib;
using MelonLoader;
using System;
using System.IO;
using System.Reflection;

[assembly: MelonInfo(typeof(ThirdSpace_GunmanContracts.ThirdSpace_GunmanContracts), "ThirdSpace_GunmanContracts", "1.1.4", "ThirdSpace")]
[assembly: MelonGame("ANB_Seth", "GunmanContracts")]

namespace ThirdSpace_GunmanContracts
{
    /// <summary>
    /// Third Space Vest haptic integration for Gunman Contracts Standalone.
    /// Harmony patches resolve game types at runtime so the DLL builds against
    /// MelonLoader + Harmony only (no Il2Cpp game assembly refs).
    /// Targets follow GunmanContracts_bhaptics.
    /// </summary>
    public class ThirdSpace_GunmanContracts : MelonMod
    {
        public static DaemonClient daemon;

        public override void OnInitializeMelon()
        {
            MelonLogger.Msg("[ThirdSpace] Initializing Third Space Vest integration for Gunman Contracts...");
            daemon = new DaemonClient();
            string configPath = Path.Combine(Directory.GetCurrentDirectory(), "Mods", "ThirdSpace_Config.txt");
            daemon.Initialize(configPath);
            if (daemon.Connect())
            {
                MelonLogger.Msg("[ThirdSpace] Ready for haptic feedback!");
                daemon.SendEvent("heartbeat", priority: 0);
                MelonLogger.Msg("[ThirdSpace] Event: heartbeat");
            }
            else
            {
                MelonLogger.Warning("[ThirdSpace] Could not connect to daemon on port 5050.");
            }
        }

        public override void OnDeinitializeMelon()
        {
            daemon?.StopAll();
            daemon?.Dispose();
        }

        internal static Type FindType(string name)
        {
            return AccessTools.TypeByName(name)
                ?? AccessTools.TypeByName("Il2Cpp." + name)
                ?? AccessTools.TypeByName("Il2CppHurricaneVR.Framework.Weapons.Guns." + name)
                ?? AccessTools.TypeByName("Il2CppHurricaneVR.Framework.Weapons.Bow." + name)
                ?? AccessTools.TypeByName("Il2CppHurricaneVR.Framework.Core." + name)
                ?? AccessTools.TypeByName("Il2CppKnifePlayerController." + name)
                ?? AccessTools.TypeByName("Il2CppInfimaGames.LowPolyShooterPack." + name);
        }

        internal static MethodBase FindMethod(string typeName, string methodName)
        {
            var type = FindType(typeName);
            if (type == null)
            {
                MelonLogger.Warning("[ThirdSpace] Type not found: " + typeName + " (patch skipped)");
                return null;
            }
            var method = AccessTools.Method(type, methodName);
            if (method == null)
                MelonLogger.Warning("[ThirdSpace] Method not found: " + typeName + "." + methodName + " (patch skipped)");
            else
                MelonLogger.Msg("[ThirdSpace] Patch target OK: " + type.FullName + "." + methodName);
            return method;
        }

        /// <summary>Resolve by full CLR type name (avoids ambiguous short names like Character).</summary>
        internal static MethodBase FindMethodExact(string fullTypeName, string methodName)
        {
            var type = AccessTools.TypeByName(fullTypeName);
            if (type == null)
            {
                MelonLogger.Warning("[ThirdSpace] Type not found: " + fullTypeName + " (patch skipped)");
                return null;
            }
            var method = AccessTools.Method(type, methodName);
            if (method == null)
                MelonLogger.Warning("[ThirdSpace] Method not found: " + fullTypeName + "." + methodName + " (patch skipped)");
            else
                MelonLogger.Msg("[ThirdSpace] Patch target OK: " + type.FullName + "." + methodName);
            return method;
        }

        internal static object GetMember(object obj, string name)
        {
            if (obj == null) return null;
            try
            {
                var traverse = Traverse.Create(obj);
                var field = traverse.Field(name);
                var fieldValue = field.GetValue();
                if (fieldValue != null) return fieldValue;
                var prop = traverse.Property(name);
                var propValue = prop.GetValue();
                if (propValue != null) return propValue;
            }
            catch { /* fall through */ }

            var type = obj.GetType();
            var accessProp = AccessTools.Property(type, name);
            if (accessProp != null)
            {
                try { return accessProp.GetValue(obj, null); }
                catch { /* fall through */ }
            }
            var accessField = AccessTools.Field(type, name);
            if (accessField != null)
            {
                try { return accessField.GetValue(obj); }
                catch { /* fall through */ }
            }
            // Il2Cpp often exposes members as get_Name / set_Name methods
            var getter = AccessTools.Method(type, "get_" + name);
            if (getter != null)
            {
                try { return getter.Invoke(obj, null); }
                catch { /* fall through */ }
            }
            return null;
        }

        internal static object GetPath(object obj, params string[] names)
        {
            foreach (var name in names)
            {
                obj = GetMember(obj, name);
                if (obj == null) return null;
            }
            return obj;
        }

        internal static bool GetBool(object obj, string name, bool fallback = false)
        {
            var value = GetMember(obj, name);
            if (value == null) return fallback;
            try { return Convert.ToBoolean(value); }
            catch { return fallback; }
        }

        internal static bool TryXYZ(object vec, out float x, out float y, out float z)
        {
            x = y = z = 0f;
            if (vec == null) return false;
            try
            {
                x = Convert.ToSingle(GetMember(vec, "x"));
                y = Convert.ToSingle(GetMember(vec, "y"));
                z = Convert.ToSingle(GetMember(vec, "z"));
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Simplified GetHapticsDirection from GunmanContracts_bhaptics.
        /// Returns yaw degrees (0 front, 90 left) or null if angle cannot be computed.
        /// </summary>
        internal static float? ComputeHitAngle(object attacker)
        {
            try
            {
                var cameraType = AccessTools.TypeByName("UnityEngine.Camera")
                    ?? AccessTools.TypeByName("Il2CppUnityEngine.Camera");
                if (cameraType == null) return null;
                var mainProp = AccessTools.Property(cameraType, "main");
                if (mainProp == null) return null;
                object camera = mainProp.GetValue(null, null);
                if (camera == null) return null;

                object playerTransform = GetMember(camera, "transform");
                object attackerTransform = GetMember(attacker, "transform");
                if (playerTransform == null || attackerTransform == null) return null;

                float px, py, pz, hx, hy, hz, ey = 0f;
                if (!TryXYZ(GetMember(playerTransform, "position"), out px, out py, out pz))
                    return null;
                if (!TryXYZ(GetMember(attackerTransform, "position"), out hx, out hy, out hz))
                    return null;

                var rot = GetMember(playerTransform, "rotation");
                if (rot != null)
                {
                    float ex, ez;
                    TryXYZ(GetMember(rot, "eulerAngles"), out ex, out ey, out ez);
                }

                float dx = hx - px;
                float dz = hz - pz;
                float mag = (float)Math.Sqrt(dx * dx + dz * dz);
                float hitAngle = 0f;
                if (mag > 1e-5f)
                {
                    // patternOrigin is (0,0,1) — angle vs forward on XZ plane
                    float dot = dz / mag;
                    if (dot > 1f) dot = 1f;
                    if (dot < -1f) dot = -1f;
                    hitAngle = (float)(Math.Acos(dot) * 180.0 / Math.PI);
                    // Cross product Y > 0 flips sign (left vs right)
                    if (-dx < 0f) hitAngle *= -1f;
                }

                float myRotation = (hitAngle - ey) * -1f;
                if (myRotation < 0f) myRotation = 360f + myRotation;
                return myRotation;
            }
            catch
            {
                return null;
            }
        }

        internal static string HandFromSide(string side)
        {
            if (string.IsNullOrEmpty(side)) return null;
            if (side == "right" || side == "backRight") return "right";
            return "left";
        }

        internal static string HolsterFromSide(string side)
        {
            if (string.IsNullOrEmpty(side)) return "hip";
            if (side == "backLeft" || side == "backRight") return "shoulder";
            return "hip";
        }

        /// <summary>
        /// Map ANBHVRGunBase.gunInHand ("Right" / "Left" / "none") to our hand string.
        /// </summary>
        internal static string HandFromGunInHand(object gun)
        {
            var raw = GetMember(gun, "gunInHand");
            if (raw == null) return null;
            string text = raw.ToString() ?? "";
            if (string.Equals(text, "none", StringComparison.OrdinalIgnoreCase)) return null;
            if (string.Equals(text, "Right", StringComparison.OrdinalIgnoreCase)) return "right";
            if (string.Equals(text, "Left", StringComparison.OrdinalIgnoreCase)) return "left";
            return null;
        }

        internal static void EmitHolster(string eventName, string side)
        {
            if (daemon == null || !daemon.IsConnected) return;
            string hand = HandFromSide(side);
            string holster = HolsterFromSide(side);
            daemon.SendEvent(eventName, hand, priority: 1, holster: holster);
            MelonLogger.Msg("[ThirdSpace] Event: " + eventName + " (" + hand + ", " + holster + ")");
        }

        internal static void EmitGunHandEvent(object gun, string eventName, int priority, bool skipIfNoHand = false)
        {
            if (daemon == null || !daemon.IsConnected) return;
            if (gun == null) return;
            string hand = HandFromGunInHand(gun);
            if (hand == null)
            {
                if (skipIfNoHand) return;
                hand = ResolveFireHand(gun);
            }
            daemon.SendEvent(eventName, hand, priority: priority);
            MelonLogger.Msg("[ThirdSpace] Event: " + eventName + " (" + hand + ")");
        }

        internal static string HandFromGrabbable(object primaryGrab)
        {
            if (primaryGrab == null) return null;
            bool isRight = GetBool(primaryGrab, "IsRightHandGrabbed");
            bool isLeft = GetBool(primaryGrab, "IsLeftHandGrabbed");
            if (isRight && !isLeft) return "right";
            if (isLeft && !isRight) return "left";
            if (isRight) return "right";
            if (isLeft) return "left";

            // Fallback: grabber refs (works when bool props fail via Il2Cpp reflection)
            if (GetMember(primaryGrab, "RightHandGrabber") != null) return "right";
            if (GetMember(primaryGrab, "LeftHandGrabber") != null) return "left";
            return null;
        }

        /// <summary>
        /// Resolve firing hand; never returns null so fire events are not silently dropped.
        /// Non-VR / FPS mode has no VR grabbers — default to right.
        /// </summary>
        internal static string ResolveFireHand(object gun)
        {
            object primaryGrab = GetMember(gun, "myGrabbable") ?? GetMember(gun, "Grabbable");
            string hand = HandFromGrabbable(primaryGrab);
            if (hand != null) return hand;

            object stabilizer = GetMember(gun, "myStabilizerGrabbable") ?? GetMember(gun, "StabilizerGrabbable");
            hand = HandFromGrabbable(stabilizer);
            if (hand != null) return hand;

            // Flatscreen / FPS: no VR hands holding the gun
            return "right";
        }

        internal static bool IsAutomaticFire(object gun)
        {
            var fireType = GetMember(gun, "FireType");
            if (fireType == null) return false;
            string text = fireType.ToString() ?? "";
            return text.IndexOf("Automatic", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        // OnFire + FPSshoot often fire together in flatscreen; keep one haptic pulse.
        private static DateTime _lastFireEmitUtc = DateTime.MinValue;
        private static readonly TimeSpan FireDebounce = TimeSpan.FromMilliseconds(45);

        /// <summary>
        /// Shared emit for VR OnFire and flatscreen FPSshoot.
        /// </summary>
        internal static void EmitGunFire(object gun, string source)
        {
            if (daemon == null || !daemon.IsConnected) return;
            if (gun == null) return;
            if (GetBool(gun, "EnemyGun")) return;
            if (GetBool(gun, "isBow")) return;

            DateTime now = DateTime.UtcNow;
            if (now - _lastFireEmitUtc < FireDebounce) return;
            _lastFireEmitUtc = now;

            string hand = ResolveFireHand(gun);

            string eventName = "gun_fire";
            if (GetBool(gun, "isShotgun"))
                eventName = "shotgun_fire";
            else if (IsAutomaticFire(gun))
                eventName = "rifle_fire";

            daemon.SendEvent(eventName, hand, priority: 2);
            MelonLogger.Msg("[ThirdSpace] Event: " + eventName + " (" + hand + ", via " + source + ")");
        }

        internal static void EmitSimple(string eventName, string hand, int priority, string source)
        {
            if (daemon == null || !daemon.IsConnected) return;
            daemon.SendEvent(eventName, hand, priority: priority);
            MelonLogger.Msg("[ThirdSpace] Event: " + eventName + " (" + hand + ", via " + source + ")");
        }

        [HarmonyPatch]
        public class Patch_HurtPlayer
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "HurtPlayer") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "HurtPlayer");

            [HarmonyPostfix]
            public static void Postfix(object __instance, string type, float dmg, object attacker)
            {
                if (daemon == null || !daemon.IsConnected) return;
                if (attacker == null) return;
                try
                {
                    float? angle = ComputeHitAngle(attacker);
                    if (angle.HasValue)
                        daemon.SendEvent("player_hit", priority: 3, angle: angle);
                    else
                        daemon.SendEvent("player_hit", priority: 3);
                    MelonLogger.Msg("[ThirdSpace] Event: player_hit" + (angle.HasValue ? " (" + angle.Value.ToString("0") + "°)" : ""));
                }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] HurtPlayer handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_HolsterGun
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "holsterGun") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "holsterGun");

            [HarmonyPostfix]
            public static void Postfix(string side, object tmpGBS)
            {
                EmitHolster("holster_in", side);
            }
        }

        [HarmonyPatch]
        public class Patch_UnholsterGun
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "unholsterGun") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "unholsterGun");

            [HarmonyPostfix]
            public static void Postfix(string side, object tmpGBS)
            {
                EmitHolster("holster_out", side);
            }
        }

        [HarmonyPatch]
        public class Patch_HolsterKnife
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "holsterKnife") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "holsterKnife");

            [HarmonyPostfix]
            public static void Postfix(string side)
            {
                EmitHolster("holster_in", side);
            }
        }

        [HarmonyPatch]
        public class Patch_UnholsterKnife
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "unholsterKnife") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "unholsterKnife");

            [HarmonyPostfix]
            public static void Postfix(string side)
            {
                EmitHolster("holster_out", side);
            }
        }

        [HarmonyPatch]
        public class Patch_GunFire
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "OnFire") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "OnFire");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunFire(__instance, "OnFire"); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] OnFire handler failed: " + ex.Message);
                }
            }
        }

        /// <summary>
        /// Flatscreen / non-VR fire path. Debounced with OnFire when both fire together.
        /// </summary>
        [HarmonyPatch]
        public class Patch_FPSShoot
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "FPSshoot") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "FPSshoot");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunFire(__instance, "FPSshoot"); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] FPSshoot handler failed: " + ex.Message);
                }
            }
        }

        /// <summary>
        /// Empty-mag slide lock. ANBHVRGunBase.OnOutOfAmmo fires when the last round is spent
        /// and the slide/cocking handle locks back — this is the hold-start signal for 2D/FPS.
        /// </summary>
        [HarmonyPatch]
        public class Patch_OnOutOfAmmo
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "OnOutOfAmmo") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "OnOutOfAmmo");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunHandEvent(__instance, "slide_lock", priority: 2); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] OnOutOfAmmo handler failed: " + ex.Message);
                }
            }
        }

        /// <summary>
        /// Infima SetSlideBack(0) is the reliable "slide pushed forward" signal during empty reload.
        /// Do NOT use FPSReleaseSlide/releaseSlide for hold-end — they fire at reload *start*.
        /// </summary>
        [HarmonyPatch]
        public class Patch_SetSlideBack
        {
            static bool Prepare() =>
                FindMethodExact("Il2CppInfimaGames.LowPolyShooterPack.Character", "SetSlideBack") != null;
            static MethodBase TargetMethod() =>
                FindMethodExact("Il2CppInfimaGames.LowPolyShooterPack.Character", "SetSlideBack");

            [HarmonyPostfix]
            public static void Postfix(int back)
            {
                if (back == 0)
                    EmitSimple("slide_release", "right", priority: 2, "SetSlideBack(0)");
                else
                    EmitSimple("slide_lock", "right", priority: 2, "SetSlideBack(" + back + ")");
            }
        }

        /// <summary>2D/FPS: magazine out during reload.</summary>
        [HarmonyPatch]
        public class Patch_FPSReloadMagout
        {
            static bool Prepare() => FindMethod("ANBFpsWeapons", "FPSReloadMagout") != null;
            static MethodBase TargetMethod() => FindMethod("ANBFpsWeapons", "FPSReloadMagout");

            [HarmonyPostfix]
            public static void Postfix(object __instance, object __0)
            {
                try { EmitGunHandEvent(__0, "mag_eject", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] FPSReloadMagout handler failed: " + ex.Message);
                }
            }
        }

        /// <summary>2D/FPS: magazine in during reload.</summary>
        [HarmonyPatch]
        public class Patch_FPSReloadMagin
        {
            static bool Prepare() => FindMethod("ANBFpsWeapons", "FPSReloadMagin") != null;
            static MethodBase TargetMethod() => FindMethod("ANBFpsWeapons", "FPSReloadMagin");

            [HarmonyPostfix]
            public static void Postfix(object __instance, object __0)
            {
                try { EmitGunHandEvent(__0, "reload", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] FPSReloadMagin handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_BowShoot
        {
            static bool Prepare() => FindMethod("HVRPhysicsBow", "ShootArrow") != null;
            static MethodBase TargetMethod() => FindMethod("HVRPhysicsBow", "ShootArrow");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                if (daemon == null || !daemon.IsConnected) return;
                try
                {
                    object bowHand = GetMember(__instance, "BowHand");
                    bool isRight = GetBool(bowHand, "IsRightHand", fallback: true);
                    string hand = isRight ? "right" : "left";
                    daemon.SendEvent("bow_fire", hand, priority: 2);
                    MelonLogger.Msg("[ThirdSpace] Event: bow_fire (" + hand + ")");
                }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] ShootArrow handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_ReleaseAmmo
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "ReleaseAmmo") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "ReleaseAmmo");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunHandEvent(__instance, "mag_eject", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] ReleaseAmmo handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_AmmoSocketed
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "OnAmmoSocketed") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "OnAmmoSocketed");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunHandEvent(__instance, "reload", priority: 1, skipIfNoHand: true); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] OnAmmoSocketed handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_HandGrabbed
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "OnHandGrabbed") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "OnHandGrabbed");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                // Upstream bhaptics plays eject-mag on hand grab (mag / charge-handle grab feel).
                try { EmitGunHandEvent(__instance, "mag_eject", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] OnHandGrabbed handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_AddShotgunShell
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "AddShotgunShell") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "AddShotgunShell");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunHandEvent(__instance, "reload", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] AddShotgunShell handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_CockEjected
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "OnCockingHandleEjected") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "OnCockingHandleEjected");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunHandEvent(__instance, "cock_back", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] OnCockingHandleEjected handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_CockReleased
        {
            static bool Prepare() => FindMethod("ANBHVRGunBase", "OnCockingHandleReleased") != null;
            static MethodBase TargetMethod() => FindMethod("ANBHVRGunBase", "OnCockingHandleReleased");

            [HarmonyPostfix]
            public static void Postfix(object __instance)
            {
                try { EmitGunHandEvent(__instance, "cock_forward", priority: 1); }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] OnCockingHandleReleased handler failed: " + ex.Message);
                }
            }
        }

        [HarmonyPatch]
        public class Patch_AmmoPouchRemove
        {
            static bool Prepare() => FindMethod("ANBAmmoBag", "removeAmmoCount") != null;
            static MethodBase TargetMethod() => FindMethod("ANBAmmoBag", "removeAmmoCount");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("ammo_pouch", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: ammo_pouch");
            }
        }

        [HarmonyPatch]
        public class Patch_CreditAmmo
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "creditAmmo") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "creditAmmo");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("ammo_pouch", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: ammo_pouch (credit)");
            }
        }

        [HarmonyPatch]
        public class Patch_SubstractAmmo
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "substractAmmo") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "substractAmmo");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("ammo_pouch", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: ammo_pouch (substract)");
            }
        }

        [HarmonyPatch]
        public class Patch_Collectible
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "collectibleCollected") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "collectibleCollected");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("ammo_pouch", priority: 0);
                MelonLogger.Msg("[ThirdSpace] Event: ammo_pouch (collectible)");
            }
        }

        [HarmonyPatch]
        public class Patch_CollectCoins
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "collectCoinWallet") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "collectCoinWallet");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("ammo_pouch", priority: 0);
                MelonLogger.Msg("[ThirdSpace] Event: ammo_pouch (coins)");
            }
        }

        [HarmonyPatch]
        public class Patch_TakeDamageLastHP
        {
            static bool Prepare() => FindMethod("ANBSFXPlayerManager", "TakeDamageLastHP") != null;
            static MethodBase TargetMethod() => FindMethod("ANBSFXPlayerManager", "TakeDamageLastHP");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("heartbeat_start", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: heartbeat_start");
            }
        }

        [HarmonyPatch]
        public class Patch_Heal
        {
            static bool Prepare() => FindMethod("ANBSFXPlayerManager", "Heal") != null;
            static MethodBase TargetMethod() => FindMethod("ANBSFXPlayerManager", "Heal");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("heartbeat_stop", priority: 1);
                daemon.SendEvent("healing", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: heartbeat_stop + healing");
            }
        }

        [HarmonyPatch]
        public class Patch_PlayerDead
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "PlayerDeadCall") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "PlayerDeadCall");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("heartbeat_stop", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: heartbeat_stop (death)");
            }
        }

        [HarmonyPatch]
        public class Patch_EndRun
        {
            static bool Prepare() => FindMethod("ANBGameLogic", "endRun") != null;
            static MethodBase TargetMethod() => FindMethod("ANBGameLogic", "endRun");

            [HarmonyPostfix]
            public static void Postfix()
            {
                if (daemon == null || !daemon.IsConnected) return;
                daemon.SendEvent("heartbeat_stop", priority: 1);
                MelonLogger.Msg("[ThirdSpace] Event: heartbeat_stop (endRun)");
            }
        }
    }
}
