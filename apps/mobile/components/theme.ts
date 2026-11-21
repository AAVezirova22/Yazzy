import {Platform,StyleSheet,type TextStyle} from 'react-native';

/**
 * Yazzy design tokens.
 *
 * Two surfaces, one accent. A deep graphite "night" carries the hero moments (the car, live driving, maps chrome)
 * with glass accents for depth; everything you read sits on a cool-white canvas of crisp, high-legibility cards.
 * Electric blue is the only accent; green, amber and red only ever mean status.
 */
export const c={
 // Canvas and cards
 bg:'#f2f4f7',surface:'#ffffff',surface2:'#f6f7f9',track:'#e4e8ee',
 ink:'#0b1220',ink2:'#2c3646',muted:'#667185',faint:'#a2abb9',
 line:'#e4e8ee',line2:'#eef1f4',
 // Accent
 blue:'#2f6bff',blue600:'#1f56e0',blue50:'#ebf1ff',blue300:'#93b4ff',
 // Night surfaces (hero, live driving, map chrome)
 night:'#0b111c',night2:'#141c2a',night3:'#1d2738',nightLine:'rgba(255,255,255,0.09)',nightMuted:'#8a96a8',
 // Glass on night: a translucent fill and a hairline edge. No real blur: blur is costly on low-end Android.
 glass:'rgba(255,255,255,0.08)',glassStrong:'rgba(255,255,255,0.14)',glassLine:'rgba(255,255,255,0.14)',
 // Frost on light: near-white panels floating over maps
 frost:'rgba(255,255,255,0.94)',frostLine:'rgba(11,18,32,0.07)',
 // Status
 green:'#12a150',green50:'#e6f6ec',amber:'#c77a0a',amber50:'#fff3df',red:'#d92d20',red50:'#fdecea',
};

/**
 * Manrope, embedded at build time (assets/fonts, app.json). Each weight is its own family, named after the font's
 * PostScript name so the same string works on iOS and Android, and Android never synthesises bold on top of it.
 * Use these instead of fontWeight. All weights carry true tabular figures (tnum).
 */
export const F={500:'Manrope-Medium',600:'Manrope-SemiBold',700:'Manrope-Bold',800:'Manrope-ExtraBold'} as const;

/** Numbers that change in place (speed, distance, totals) keep their width, so digits never jiggle. */
export const tabular:TextStyle={fontVariant:['tabular-nums']};

export const type=StyleSheet.create({
 display:{fontFamily:F[800],fontSize:34,lineHeight:40,letterSpacing:-1,color:c.ink},
 h1:{fontFamily:F[800],fontSize:28,lineHeight:34,letterSpacing:-0.7,color:c.ink},
 h2:{fontFamily:F[700],fontSize:20,lineHeight:26,letterSpacing:-0.3,color:c.ink},
 title:{fontFamily:F[700],fontSize:16,lineHeight:22,letterSpacing:-0.1,color:c.ink},
 label:{fontFamily:F[700],fontSize:14,lineHeight:19,color:c.ink},
 body:{fontFamily:F[500],fontSize:14,lineHeight:20,color:c.muted},
 caption:{fontFamily:F[500],fontSize:12.5,lineHeight:17,color:c.muted},
 overline:{fontFamily:F[700],fontSize:11,lineHeight:14,letterSpacing:1.1,textTransform:'uppercase',color:c.muted},
 metric:{fontFamily:F[800],fontSize:28,lineHeight:33,letterSpacing:-0.8,color:c.ink,fontVariant:['tabular-nums']},
 metricXL:{fontFamily:F[800],fontSize:58,lineHeight:64,letterSpacing:-2,color:'#fff',fontVariant:['tabular-nums']},
 unit:{fontFamily:F[600],fontSize:13,lineHeight:17,color:c.muted,letterSpacing:0},
});

/** 4-point grid. */
export const space={xs:4,sm:8,md:12,lg:16,xl:20,xxl:24,xxxl:32};
export const radius={sm:12,md:16,lg:22,xl:28,pill:999};

/**
 * Motion. Press feedback is a 120 ms, 3% scale; anything a finger drags or flings settles on a spring that takes
 * the release velocity. Springs use the two designer parameters (perceived duration, damping ratio).
 */
export const motion={
 press:{duration:120,scale:0.97},
 /** Strong ease-out for UI, as a CSS timing function for Reanimated transitions. */
 easeOut:'cubic-bezier(0.23, 1, 0.32, 1)',
 /** On-screen movement (tab and segment indicators). */
 easeInOut:'cubic-bezier(0.77, 0, 0.175, 1)',
 snap:{duration:400,dampingRatio:0.8},
 sheet:{duration:300,dampingRatio:0.8},
 settle:{duration:400,dampingRatio:1},
};

export const mono=Platform.OS==='ios'?'Menlo':'monospace';

// One soft shadow for cards (plus a hairline edge, which stays crisp on low-density screens) and one for floating chrome.
export const shadow={shadowColor:'#0b1220',shadowOpacity:0.06,shadowRadius:16,shadowOffset:{width:0,height:6},elevation:2};
export const floatShadow={shadowColor:'#0b1220',shadowOpacity:0.2,shadowRadius:24,shadowOffset:{width:0,height:10},elevation:10};

export const ui=StyleSheet.create({
 card:{backgroundColor:c.surface,borderRadius:radius.lg,padding:18,marginBottom:12,borderWidth:StyleSheet.hairlineWidth,borderColor:c.frostLine,...shadow},
 title:type.title,
 body:type.body,
 caption:type.caption,
 overline:type.overline,
 value:type.metric,
 unit:type.unit,
 input:{backgroundColor:c.surface2,borderRadius:radius.md,borderWidth:1,borderColor:c.line,paddingHorizontal:16,paddingVertical:13,fontSize:15,fontFamily:F[600],color:c.ink,marginBottom:10},
 row:{flexDirection:'row',alignItems:'center'},
});
