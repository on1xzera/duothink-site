#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_position;
in vec3 v_local;
in float v_occlusion;
out vec4 fragColor;

vec3 studioReflection(vec3 direction) {
  float front = max(direction.z, 0.0);
  vec3 light = vec3(0.12 + 0.1 * (direction.y * 0.5 + 0.5));
  // Broad white softboxes and narrow reflected strips form the polished metal finish.
  light += vec3(1.7) * pow(max(dot(direction, normalize(vec3(-0.28, 0.12, 1.0))), 0.0), 28.0);
  light += vec3(1.1) * pow(max(dot(direction, normalize(vec3(0.75, 0.5, 0.6))), 0.0), 28.0);
  light += vec3(0.75) * exp(-pow((direction.x - 0.42) * 14.0, 2.0)) * front;
  light += vec3(0.5) * exp(-pow((direction.y + 0.5) * 12.0, 2.0)) * front;
  return light;
}

void main() {
  vec3 n = normalize(v_normal);
  vec3 view = normalize(vec3(0.0, 0.0, 4.6) - v_position);
  vec3 reflection = reflect(-view, n);
  float fresnel = 0.92 + 0.08 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  float illumination = max(dot(n, normalize(vec3(-0.45, 0.75, 1.0))), 0.0);
  float brushed = 1.0 + sin(v_local.y * 780.0 + v_local.x * 11.0) * 0.006;
  vec3 silver = vec3(0.96, 0.975, 1.0);
  vec3 color = silver * studioReflection(reflection) * fresnel;
  color += silver * (0.075 + 0.12 * illumination);
  color *= v_occlusion * brushed;
  // Preserve the original horizontal overlap: the upper tab shades the lower one.
  float seam = (301.0 - 277.5) / 301.0;
  float lowerTab = 1.0 - step(seam, v_local.y);
  float underlap = exp(-max(seam - v_local.y, 0.0) * 17.0);
  underlap *= 1.0 - smoothstep(0.18, 0.32, v_local.x);
  color *= 1.0 - lowerTab * (0.12 + 0.64 * underlap);
  // Filmic highlight rolloff keeps the base white while retaining shaded bevels.
  color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
  fragColor = vec4(pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
