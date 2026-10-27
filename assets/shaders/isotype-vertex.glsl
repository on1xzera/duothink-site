#version 300 es
precision highp float;
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in float occlusion;
uniform vec2 u_rotation;
uniform vec2 u_resolution;
out vec3 v_normal;
out vec3 v_position;
out vec3 v_local;
out float v_occlusion;

void main() {
  float cx = cos(u_rotation.x), sx = sin(u_rotation.x);
  float cy = cos(u_rotation.y), sy = sin(u_rotation.y);
  mat3 rotateX = mat3(1, 0, 0, 0, cx, sx, 0, -sx, cx);
  mat3 rotateY = mat3(cy, 0, -sy, 0, 1, 0, sy, 0, cy);
  mat3 rotation = rotateY * rotateX;
  vec3 world = rotation * position;
  float aspect = u_resolution.x / u_resolution.y;
  float scale = 0.94 * min(1.0, aspect / (647.0 / 602.0));
  gl_Position = vec4(world.x * scale / aspect - 0.05, world.y * scale, -world.z * 0.5, 1.0);
  v_normal = rotation * normal;
  v_position = world;
  v_local = position;
  v_occlusion = occlusion;
}
