import {Platform,StyleSheet,type TextStyle} from 'react-native';

/**
 * Yazzy design tokens: precise and quiet.
 *
 * Square geometry (2–6 px corners), flat surfaces drawn with hairlines instead of soft shadows, generous space,
 * wide-tracked labels and light, large numerals. A near-black "night" carries the hero moments (the car, live
 * driving, map chrome); everything you read sits on a neutral canvas. One electric-blue accent, used sparingly for
 * the active state and the main action; green, amber and red only ever mean status.
 */
export const c={
 // Canvas and surfaces
 bg:'#f3f4f6',surface:'#ffffff',surface2:'#f7f8fa',track:'#e6e8ec',
 ink:'#0a0b0d',ink2:'#2a2f37',muted:'#6b7280',faint:'#a4abb6',
 line:'#e2e5ea',line2:'#eef0f3',
 // Accent
 blue:'#2f6bff',blue600:'#1f56e0',blue50:'#edf2ff',blue300:'#8fb0ff',
 // Night surfaces
 night:'#0a0b0d',night2:'#121419',night3:'#1a1d23',nightLine:'rgba(255,255,255,0.1)',nightMuted:'#8b929e',
 // Glass on night: a faint fill and a hairline edge. No blur: blur is costly on low-end Android.
 glass:'rgba(255,255,255,0.06)',glassStrong:'rgba(255,255,255,0.12)',glassLine:'rgba(255,255,255,0.14)',
 // Panels floating over maps
 frost:'rgba(255,255,255,0.97)',frostLine:'#e2e5ea',
 // Status
 green:'#12a150',green50:'#e8f6ee',amber:'#c77a0a',amber50:'#fdf4e3',red:'#d92d20',red50:'#fdeceb',
};

/**
 * Manrope, embedded at build time (assets/fonts, app.json). Each weight is its own family, named after the font's
 * PostScript name so the same string works on iOS and Android, and Android never synthesises bold on top of it.
 * Use these instead of fontWeight. All weights carry true tabular figures (tnum).
 */
export const F={500:'Manrope-Medium',600:'Manrope-SemiBold',700:'Manrope-Bold',800:'Manrope-ExtraBold'} as const;

/** Numbers that change in place (speed, distance, totals) keep their width, so digits never jiggle. */
export const tabular:TextStyle={fontVariant:['tabular-nums']};

// Big numerals are set light and tight; small labels are bold, uppercase and widely tracked.
export const type=StyleSheet.create({
 display:{fontFamily:F[600],fontSize:34,lineHeight:40,letterSpacing:-1.1,color:c.ink},
 h1:{fontFamily:F[700],fontSize:28,lineHeight:34,letterSpacing:-0.8,color:c.ink},
 h2:{fontFamily:F[700],fontSize:19,lineHeight:25,letterSpacing:-0.3,color:c.ink},
 title:{fontFamily:F[700],fontSize:15.5,lineHeight:21,letterSpacing:-0.1,color:c.ink},
 label:{fontFamily:F[700],fontSize:14,lineHeight:19,color:c.ink},
 body:{fontFamily:F[500],fontSize:14,lineHeight:20,color:c.muted},
 caption:{fontFamily:F[500],fontSize:12.5,lineHeight:17,color:c.muted},
 overline:{fontFamily:F[700],fontSize:10.5,lineHeight:14,letterSpacing:1.6,textTransform:'uppercase',color:c.muted},
 metric:{fontFamily:F[600],fontSize:28,lineHeight:33,letterSpacing:-1,color:c.ink,fontVariant:['tabular-nums']},
 metricXL:{fontFamily:F[500],fontSize:60,lineHeight:66,letterSpacing:-2.4,color:'#fff',fontVariant:['tabular-nums']},
 unit:{fontFamily:F[600],fontSize:12.5,lineHeight:17,color:c.muted,letterSpacing:0.2},
});

/** 4-point grid. */
export const space={xs:4,sm:8,md:12,lg:16,xl:20,xxl:24,xxxl:32};
/** Square geometry: small, consistent corners. "pill" is kept as a name for controls, but it is square too. */
export const radius={sm:2,md:3,lg:4,xl:6,pill:3};

/**
 * Motion. Press feedback is a 120 ms, 3% scale; anything a finger drags or flings settles on a spring that takes
 * the release velocity. Springs use the two designer parameters (perceived duration, damping ratio).
 */
export const motion={
 press:{duration:120,scale:0.97},
 /** Strong ease-out for UI, as cubic-bezier control points (see motion.tsx). */
 easeOut:[0.23,1,0.32,1] as const,
 /** On-screen movement (tab and segment indicators). */
 easeInOut:[0.77,0,0.175,1] as const,
 snap:{duration:400,dampingRatio:0.8},
 sheet:{duration:300,dampingRatio:0.8},
 settle:{duration:400,dampingRatio:1},
};

export const mono=Platform.OS==='ios'?'Menlo':'monospace';

// Surfaces are flat and drawn with hairlines; only floating chrome (sheets over maps, the tab bar) casts a shadow.
export const shadow={shadowColor:'#000',shadowOpacity:0,shadowRadius:0,shadowOffset:{width:0,height:0},elevation:0};
export const floatShadow={shadowColor:'#000',shadowOpacity:0.14,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:8};
export const hairline={borderWidth:StyleSheet.hairlineWidth,borderColor:c.line};

export const ui=StyleSheet.create({
 card:{backgroundColor:c.surface,borderRadius:radius.lg,padding:18,marginBottom:12,...hairline},
 title:type.title,
 body:type.body,
 caption:type.caption,
 overline:type.overline,
 value:type.metric,
 unit:type.unit,
 input:{backgroundColor:c.surface,borderRadius:radius.md,borderWidth:1,borderColor:c.line,paddingHorizontal:14,paddingVertical:13,fontSize:15,fontFamily:F[600],color:c.ink,marginBottom:10},
 row:{flexDirection:'row',alignItems:'center'},
});
