// Server-side Third Space hooks for Titanfall 2 campaign (flat Northstar + VR).
//
// In the campaign the server runs inside the game process, so the TS_*
// natives are available here as well and play directly.
//
// These hooks come from Northstar's multiplayer server scripts. If one of
// them doesn't exist in the campaign, the game reports a SERVER script
// COMPILE ERROR naming it, and that hook has to be removed or replaced.

global function TF2VR_TS_ServerInit

#if TF2VR_THIRDSPACE

// ---- Tuning ----
const float TS_ZIPLINE_INTERVAL = 0.2 // seconds between "zipline" events

struct
{
	int           ziplineGeneration = 0
	bool          ziplineActive     = false
	array<entity> hookedPlayers
} file

#endif

void function TF2VR_TS_ServerInit()
{
#if TF2VR_THIRDSPACE
	TS_Debug( "server script init" )

	AddCallback_OnPlayerKilled( TS_OnPlayerKilled )
	AddCallback_ZiplineStart( TS_OnZiplineStart )
	AddCallback_ZiplineStop( TS_OnZiplineStop )
	AddCallback_OnTitanBecomesPilot( TS_OnTitanBecomesPilot )
	AddCallback_OnTitanHealthSegmentLost( TS_OnTitanHealthSegmentLost )
	AddSoulDeathCallback( TS_OnSoulDeath )

	// Per-player hooks (shield, movement) need the player entity:
	// register them when it spawns. Both sources are deduplicated.
	AddSpawnCallback( "player", TS_OnPlayerEntitySpawned )
	AddCallback_OnPlayerRespawned( TS_OnPlayerEntitySpawned )
#endif
}

#if TF2VR_THIRDSPACE

// ===================================================================
//  Helpers
// ===================================================================

bool function TS_IsOurPlayer( entity ent )
{
	return IsValid( ent ) && ent.IsPlayer()
}

// ===================================================================
//  Per-player hooks: 2. shield damage, 6. movement
// ===================================================================

void function TS_OnPlayerEntitySpawned( entity player )
{
	if ( !TS_IsOurPlayer( player ) || file.hookedPlayers.contains( player ) )
		return
	file.hookedPlayers.append( player )
	TS_Debug( "Registering per-player hooks" )

	AddEntityCallback_OnPostShieldDamage( player, TS_OnPostShieldDamage )

	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.JUMP,          TS_OnJump )
	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.DOUBLE_JUMP,   TS_OnJump )
	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.DODGE,         TS_OnDodge )
	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.TOUCH_GROUND,  TS_OnLand )
	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.MANTLE,        TS_OnMantle )
	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.BEGIN_WALLRUN, TS_OnBeginWallrun )
	AddPlayerMovementEventCallback( player, ePlayerMovementEvents.END_WALLRUN,   TS_OnEndWallrun )
}

// ===================================================================
//  2. Shield damage
// ===================================================================

void function TS_OnPostShieldDamage( entity ent, var damageInfo, float shieldDamage )
{
	if ( !TS_IsOurPlayer( ent ) || shieldDamage <= 0.0 )
		return

	TS_Debug( "Shield damage " + shieldDamage )
	TS_Play( "shield_damage" )
}

// ===================================================================
//  4. Death
// ===================================================================

void function TS_OnPlayerKilled( entity victim, entity attacker, var damageInfo )
{
	if ( !TS_IsOurPlayer( victim ) )
		return

	TS_StopZipline( "player killed" )
	TS_Play( "player_killed" )
	ServerToClientStringCommand( victim, "TS_PlayerKilled" ) // stops the client heartbeat
}

// ===================================================================
//  6. Movement
// ===================================================================

void function TS_OnJump( entity player )         { TS_Play( "player_jump" ) }
void function TS_OnDodge( entity player )        { TS_Play( "player_dodge" ) }
void function TS_OnLand( entity player )         { TS_Play( "player_land" ) }
void function TS_OnMantle( entity player )       { TS_Play( "player_mantle" ) }
void function TS_OnBeginWallrun( entity player ) { TS_Play( "begin_wallrun" ) }
void function TS_OnEndWallrun( entity player )   { TS_Play( "end_wallrun" ) }

// Zipline loop

void function TS_OnZiplineStart( entity player, entity zipline )
{
	if ( !TS_IsOurPlayer( player ) || file.ziplineActive )
		return

	file.ziplineActive = true
	file.ziplineGeneration++
	TS_Debug( "Zipline loop started" )
	thread TS_ZiplineThread( player, file.ziplineGeneration )
}

void function TS_OnZiplineStop( entity player )
{
	if ( TS_IsOurPlayer( player ) )
		TS_StopZipline( "zipline stop" )
}

void function TS_StopZipline( string reason )
{
	if ( !file.ziplineActive )
		return

	file.ziplineActive = false
	file.ziplineGeneration++ // ends the running thread at its next iteration
	TS_Debug( "Zipline loop stopped (" + reason + ")" )
}

void function TS_ZiplineThread( entity player, int generation )
{
	while ( generation == file.ziplineGeneration && IsValid( player ) )
	{
		TS_Play( "zipline" )
		wait TS_ZIPLINE_INTERVAL
	}
}

// ===================================================================
//  8.-10. Titan
// ===================================================================

void function TS_OnTitanBecomesPilot( entity pilot, entity npcTitan )
{
	if ( TS_IsOurPlayer( pilot ) )
		TS_Play( "player_exit_titan" )
}

void function TS_OnTitanHealthSegmentLost( entity victim, entity attacker )
{
	// victim is the player entity while embarked
	if ( TS_IsOurPlayer( victim ) )
		TS_Play( "titan_hit" )
}

void function TS_OnSoulDeath( entity soul, var damageInfo )
{
	if ( !IsValid( soul ) )
		return

	// Our Titan: either we are in it, or it is BT running as auto-titan.
	entity titan = soul.GetTitan()
	bool ours = TS_IsOurPlayer( titan ) || TS_IsOurPlayer( soul.GetBossPlayer() )
	if ( ours )
		TS_Play( "titan_destroyed" )
}

#endif
