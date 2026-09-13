using HarmonyLib;
using MelonLoader;
using System;
using System.IO;
using System.Reflection;

[assembly: MelonInfo(typeof(ThirdSpace_GunmanContracts.ThirdSpace_GunmanContracts), "ThirdSpace_GunmanContracts", "1.0.0", "ThirdSpace")]
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
                ?? AccessTools.TypeByName("Il2CppHurricaneVR.Framework.Weapons.Bow." + name);
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
                return prop.GetValue();
            }
            catch { /* fall through */ }

            var type = obj.GetType();
            var accessProp = AccessTools.Property(type, name);
            if (accessProp != null) return accessProp.GetValue(obj, null);
            var accessField = AccessTools.Field(type, name);
            return accessField?.GetValue(obj);
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

        internal static string HandFromGrabbable(object primaryGrab)
        {
            if (primaryGrab == null) return null;
            bool isRight = GetBool(primaryGrab, "IsRightHandGrabbed");
            bool isLeft = GetBool(primaryGrab, "IsLeftHandGrabbed");
            if (isRight && !isLeft) return "right";
            if (isLeft && !isRight) return "left";
            if (isRight) return "right";
            if (isLeft) return "left";
            return null;
        }

        internal static bool IsAutomaticFire(object gun)
        {
            var fireType = GetMember(gun, "FireType");
            if (fireType == null) return false;
            string text = fireType.ToString() ?? "";
            return text.IndexOf("Automatic", StringComparison.OrdinalIgnoreCase) >= 0;
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
                catch { /* HurtPlayer layout can vary */ }
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
                if (daemon == null || !daemon.IsConnected) return;
                string hand = HandFromSide(side);
                string holster = HolsterFromSide(side);
                daemon.SendEvent("holster_in", hand, priority: 1, holster: holster);
                MelonLogger.Msg("[ThirdSpace] Event: holster_in (" + hand + ", " + holster + ")");
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
                if (daemon == null || !daemon.IsConnected) return;
                string hand = HandFromSide(side);
                string holster = HolsterFromSide(side);
                daemon.SendEvent("holster_out", hand, priority: 1, holster: holster);
                MelonLogger.Msg("[ThirdSpace] Event: holster_out (" + hand + ", " + holster + ")");
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
                if (daemon == null || !daemon.IsConnected) return;
                try
                {
                    if (GetBool(__instance, "EnemyGun")) return;
                    if (GetBool(__instance, "isBow")) return;

                    object primaryGrab = GetMember(__instance, "myGrabbable");
                    string hand = HandFromGrabbable(primaryGrab);
                    if (hand == null) return;

                    string eventName = "gun_fire";
                    if (GetBool(__instance, "isShotgun"))
                        eventName = "shotgun_fire";
                    else if (IsAutomaticFire(__instance))
                        eventName = "rifle_fire";

                    daemon.SendEvent(eventName, hand, priority: 2);
                    MelonLogger.Msg("[ThirdSpace] Event: " + eventName + " (" + hand + ")");
                }
                catch { /* OnFire layout can vary by game version */ }
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
                catch { /* Bow layout can vary */ }
            }
        }
    }
}
