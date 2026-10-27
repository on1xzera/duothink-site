void main() {
  vec2 uv = v_uv;
  vec2 res = u_resolution.xy / u_pixelRatio;

  // Aspect/scale-independent reference length
  float ref = sqrt(res.x * res.y);

  // Fixed simulation grid with constant cell count, square cells in screen space
  vec2 simRes = res / ref * u_simDetail;
  vec2 px = 1.0 / simRes;

  vec4 prevData = texture(u_rippleTrail_buffer, uv);
  float current = prevData.r;
  float previous = prevData.g;

  float left  = texture(u_rippleTrail_buffer, uv - vec2(px.x, 0.0)).r;
  float right = texture(u_rippleTrail_buffer, uv + vec2(px.x, 0.0)).r;
  float down  = texture(u_rippleTrail_buffer, uv - vec2(0.0, px.y)).r;
  float up    = texture(u_rippleTrail_buffer, uv + vec2(0.0, px.y)).r;

  float neighborAverage = (left + right + down + up) * 0.25;
  float r = u_deltaTime * 60.0;
  float decay = pow(mix(0.95, 0.99, u_trailDecay), r);
  float next = (neighborAverage * 2.0 - previous) * decay;

  // Distance measured in reference units
  vec2 p     = uv * res / ref;
  vec2 mouse = u_mousePosition.xy * res / ref;
  float dist = distance(p, mouse);

  // --- drag stamp (shows while pressing + moving) ---
  float stamp = 1.0 - smoothstep(u_trailRadius * (1.0 - u_trailSoftness), u_trailRadius, dist);
  float centerFade = smoothstep(0.0, u_centerFade * 0.2, dist);

  float speed = length(u_mousePosition.zw);
  float speedAmount = clamp(speed * u_trailStrength, 0.0, 1.0);
  float pressAmount = 1.0 + u_mousePointerDown * 1.5;

  next += stamp * centerFade * u_mouseHover * speedAmount * pressAmount * min(r, 3.0); //*r for fps normalization

  fragColor = vec4(next, current, 0.0, 1.0);
}
