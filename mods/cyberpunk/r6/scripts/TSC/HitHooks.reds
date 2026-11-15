// Incoming damage on the player → directional player_hit.
// Best-effort angle: 0° front, 90° left, 180° back, 270° right.

public func TSC_HitAngleDegrees(player: ref<GameObject>, hitPos: Vector4) -> Float {
  let playerPos: Vector4 = player.GetWorldPosition();
  let forward: Vector4 = player.GetWorldForward();

  let dx: Float = hitPos.X - playerPos.X;
  let dy: Float = hitPos.Y - playerPos.Y;
  let len: Float = SqrtF(dx * dx + dy * dy);
  if len < 0.001 {
    return -1.0; // unknown → daemon uses front torso default
  }
  dx /= len;
  dy /= len;

  let fx: Float = forward.X;
  let fy: Float = forward.Y;
  let flen: Float = SqrtF(fx * fx + fy * fy);
  if flen < 0.001 {
    return -1.0;
  }
  fx /= flen;
  fy /= flen;

  let dot: Float = dx * fx + dy * fy;
  let cross: Float = dx * fy - dy * fx; // >0 → hit from left of facing
  let angle: Float = Rad2Deg(AtanF(cross, dot));
  // AtanF returns -180..180 with 0 = front; convert to 0..360 (90 = left).
  if angle < 0.0 {
    angle += 360.0;
  }
  return angle;
}

public func TSC_HitIntensity(evt: ref<gameHitEvent>) -> Float {
  if !IsDefined(evt) || !IsDefined(evt.attackComputed) {
    return 0.7;
  }
  let total: Float =
    evt.attackComputed.GetTotalAttackValue(gamedataStatPoolType.Health);
  // Soft clamp into 0.3 .. 1.0 for typical bullet/melee ranges.
  if total <= 0.0 {
    return 0.5;
  }
  let t: Float = total / 40.0;
  if t < 0.3 {
    t = 0.3;
  }
  if t > 1.0 {
    t = 1.0;
  }
  return t;
}

@wrapMethod(PlayerPuppet)
protected cb func OnHit(evt: ref<gameHitEvent>) -> Bool {
  let result: Bool = wrappedMethod(evt);

  if !IsDefined(evt) {
    return result;
  }
  // Ignore self-damage / non-attack noise when possible.
  if IsDefined(evt.attackData) {
    let instigator: wref<GameObject> = evt.attackData.GetInstigator();
    if IsDefined(instigator) && instigator == this {
      return result;
    }
  }

  let angle: Float = TSC_HitAngleDegrees(this, evt.hitPosition);
  let intensity: Float = TSC_HitIntensity(evt);
  TSC_Hit(angle, intensity);
  return result;
}
