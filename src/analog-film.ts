/** Soft video transfer over the rendered world; UI stays outside this pass. */
export const analogFilmFragment = `
uniform sampler2D tDiffuse;
uniform float time;
uniform float bend;
uniform float analog;
varying vec2 vUv;
float grainHash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float videoLuma(vec3 c){return dot(c,vec3(.299,.587,.114));}
vec3 picture(vec2 uv){return texture2D(tDiffuse,clamp(uv,vec2(.001),vec2(.999))).rgb;}
void main(){
  vec2 p=vUv*2.-1.;
  vec2 uv=.5+.5*p*(1.+bend*dot(p,p))/(1.+bend*1.65);
  vec3 c=picture(uv);
  if(analog>.001){
    // A fixed video-sized footprint keeps the finish consistent across displays.
    vec2 texel=vec2(1./960.,1./540.);
    vec2 blur=texel*(.65+.65*analog);
    vec3 soft=c*.4;
    soft+=picture(uv+vec2(blur.x,0.))*.15;
    soft+=picture(uv-vec2(blur.x,0.))*.15;
    soft+=picture(uv+vec2(0.,blur.y))*.15;
    soft+=picture(uv-vec2(0.,blur.y))*.15;
    vec3 left=picture(uv-vec2(texel.x*(2.+3.*analog),0.));
    vec3 right=picture(uv+vec2(texel.x*(1.+2.*analog),0.));
    float y=videoLuma(soft);
    vec3 chroma=(soft-vec3(y))*.4;
    chroma+=(left-vec3(videoLuma(left)))*.4;
    chroma+=(right-vec3(videoLuma(right)))*.2;
    vec3 video=vec3(y)+chroma*.96;
    // A restrained one-sided dark echo and lifted blue-violet shadow floor.
    float echo=max(0.,y-videoLuma(left));
    video-=vec3(echo*.1);
    video=video*.965+vec3(.014,.017,.026);
    video=mix(video,video*vec3(1.025,1.,.975),.5);
    c=mix(c,max(video,vec3(0.)),analog);
  }
  float grain=(grainHash(gl_FragCoord.xy+floor(time*12.))-.5)*mix(.014,.008,analog);
  c+=grain;
  c*=1.-.12*pow(length(p*.7),2.);
  c=mix(c,vec3(videoLuma(c)),.018);
  gl_FragColor=vec4(c,1.);
}`;
