const int SLOTS = 9; // keep in sync with clickState

vec2 coverFit(vec2 uv) {
  vec2 flipped = vec2(uv.x, 1.0 - uv.y);
  vec2 texRes = vec2(textureSize(u_texture, 0));
  vec2 ratio = u_resolution.xy / texRes;
  float maxRatio = max(ratio.x, ratio.y);
  vec2 fit = ratio / maxRatio;
  // Keep the statue's face inside narrow screens, matching the image fallback.
  return flipped * fit + (1.0 - fit) * vec2(0.25, 0.5);
}

// Ripple lifetime derived from the shared Decay prop.
// Must match clickState's clickLifetime() exactly.
float clickLifetime() {
  float f = mix(0.9, 0.95, u_trailDecay);
  return -3.0 / (log(f) / log(10.0)) / 60.0;
}

// Analytic expanding ring for one ripple
vec2 clickRingOffset(vec2 uv, vec2 res, float ref, vec2 originUV, float age) {
  vec2 p      = uv * res / ref;
  vec2 origin = originUV * res / ref;
  vec2 d      = p - origin;
  float dist  = length(d);
  if (dist < 1e-5) return vec2(0.0);
  vec2 dir    = d / dist;

  float life = clickLifetime();

  // Normalized progress
  float t = clamp(u_clickSpeed * age / life, 0.0, 1.0);

  float reach = u_trailRadius * 3.0;
  float front = reach * t;
  float k    = 6.2831853 / max(0.25 * reach, 1e-4); // wavelength
  float band = max(0.25 * reach, 1e-3);              // bandwidth

  float x        = dist - front;
  float envelope = exp(-(x * x) / (band * band));
  float fade     = 1.0 - smoothstep(life * 0.6, life, age);
  float wave     = cos(k * x) * envelope * fade;

  vec2 dirUV = normalize(dir * ref / res);
  return dirUV * wave * u_trailStrength * 0.02;
}

void main() {
  vec2 uv = v_uv;
  vec2 res = u_resolution.xy / u_pixelRatio;
  float ref = sqrt(res.x * res.y);

  // Must match the buffer pass.
  const float simDetail = 800.0;
  vec2 simRes = res / ref * simDetail;
  vec2 px = 1.0 / simRes;

  float hL = texture(u_rippleTrail_buffer, uv - vec2(px.x, 0.0)).r;
  float hR = texture(u_rippleTrail_buffer, uv + vec2(px.x, 0.0)).r;
  float hD = texture(u_rippleTrail_buffer, uv - vec2(0.0, px.y)).r;
  float hU = texture(u_rippleTrail_buffer, uv + vec2(0.0, px.y)).r;

  // Drag trail: gradient of the simulated height field.
  vec2 grad = vec2(hL - hR, hD - hU);
  vec2 dragOffset = grad * u_trailDisplacement * ref / res;

  // Click ripples: sum every active analytic ring (bands 1..SLOTS-1).
  vec2 clickOffset = vec2(0.0);
  if (u_clickRipple > 0.5) {
    float life = clickLifetime();
    for (int i = 1; i < SLOTS; i++) {
      vec4 slot = texture(u_clickState_buffer, vec2((float(i) + 0.5) / float(SLOTS), 0.5));
      float age = slot.b;
      if (age < 0.0 || age > life) continue;
      clickOffset += clickRingOffset(uv, res, ref, slot.rg, age);
    }
  }

  vec2 baseOffset = dragOffset + clickOffset;

  vec2 offsetR = baseOffset * (1.0 - u_dispersion * 0.5);
  vec2 offsetG = baseOffset;
  vec2 offsetB = baseOffset * (1.0 + u_dispersion * 0.5);

  vec4 sR = texture(u_texture, coverFit(uv + offsetR));
  vec4 sG = texture(u_texture, coverFit(uv + offsetG));
  vec4 sB = texture(u_texture, coverFit(uv + offsetB));

  fragColor = vec4(sR.r, sG.g, sB.b, sG.a); //or originally alpha 1.
}
