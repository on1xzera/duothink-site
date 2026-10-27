const int SLOTS = 9; // band 0 reserved + 8 ripples — keep in sync with main pass

vec4 readSlot(int i) {
  return texture(u_clickState_buffer, vec2((float(i) + 0.5) / float(SLOTS), 0.5));
}

// Ripple lifetime derived from the shared Decay prop.
float clickLifetime() {
  float f = mix(0.9, 0.95, u_trailDecay);
  return -3.0 / (log(f) / log(10.0)) / 60.0;
}

void main() {
  int s = int(clamp(floor(v_uv.x * float(SLOTS)), 0.0, float(SLOTS - 1)));

  float life = clickLifetime();

  // Clicks and hover movement share the same circular ripple simulation.
  // Detect each new impulse rather than generating one on every frame.
  float down = max(u_mousePointerDown, u_hoverPulse);

  // Band 0 holds last frame's state:
  //   .r = previous eased value   .g = was-rising flag   .b = seconds since last spawn
  vec4  g         = readSlot(0);
  float prevDown  = g.r;
  float wasRising = g.g;
  float cooldown  = g.b;
  if (g == vec4(0.0)) cooldown = 100.0; // fresh buffer: allow the first spawn

  float delta    = down - prevDown;
  bool  rising    = (delta > 0.003);                  // real upward impulse, tunable
  bool  spawnNow  = rising && (wasRising < 0.5)       // just started rising = a new press
  && (cooldown > 0.05);             // debounce spring ringing / double-fire

  if (s == 0) {
    // Carry the eased value + trend forward, and reset the spawn cooldown.
    float nextCooldown = spawnNow ? 0.0 : min(cooldown + u_deltaTime, 100.0);
    fragColor = vec4(down, rising ? 1.0 : 0.0, nextCooldown, 0.0);
    return;
  }

  // --- ripple bands ---
  vec4 next = readSlot(s);
  if (next == vec4(0.0)) next = vec4(0.0, 0.0, -1.0, 0.0); // first-touch init

  // Age + expire.
  if (next.b >= 0.0) {
    float a = next.b + u_deltaTime;
    next.b = (a > life) ? -1.0 : a;
  }

  // Pick target ripple slot: free first, else oldest active.
  int   target = 1;
  float best   = -1e9;
  for (int i = 1; i < SLOTS; i++) {
    float age   = readSlot(i).b;
    float score = (age < 0.0) ? 1e6 : age;
    if (score > best) { best = score; target = i; }
  }

  // Spawn at the live cursor on the leading edge of a press.
  // u_mousePosition.xy (not g.rg) because band 0 only commits the new
  // origin this frame, while every band reads last frame's buffer.
  if (spawnNow && s == target) {
    next.rg = u_mousePosition.xy;
    next.b  = 0.0;
  }

  fragColor = next;
}
