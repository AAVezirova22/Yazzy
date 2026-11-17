import {Platform,StyleSheet} from 'react-native';

/** Cool grey canvas, white cards, a night-blue for dark surfaces and one electric-blue accent. */
export const c={
 bg:'#eef1f5',surface:'#ffffff',surface2:'#f5f7fa',track:'#e3e8ee',
 ink:'#0f1720',ink2:'#3a4552',muted:'#7a8594',faint:'#a9b2be',
 line:'#e3e8ee',line2:'#edf0f4',
 blue:'#2f7bf5',blue600:'#1f64d8',blue50:'#e8f0fe',blue300:'#8db6fa',
 night:'#161b22',night2:'#1f2630',nightLine:'#2c3440',nightMuted:'#8c97a6',
 green:'#16a34a',green50:'#e7f6ec',amber:'#d97706',amber50:'#fef3e2',red:'#dc2626',red50:'#fdecec',
};

export const mono=Platform.OS==='ios'?'Menlo':'monospace';

// One soft shadow for every floating surface; elevation is cheap on low-end Android.
export const shadow={shadowColor:'#1b2a41',shadowOpacity:0.08,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:3};

export const ui=StyleSheet.create({
 card:{backgroundColor:c.surface,borderRadius:22,padding:18,marginBottom:14,...shadow},
 title:{fontSize:17,fontWeight:'700',color:c.ink,letterSpacing:-0.2},
 body:{fontSize:13.5,lineHeight:20,color:c.muted},
 caption:{fontSize:12.5,color:c.muted},
 value:{fontSize:26,fontWeight:'700',color:c.ink,letterSpacing:-0.6,fontVariant:['tabular-nums']},
 unit:{fontSize:13,fontWeight:'600',color:c.muted,letterSpacing:0},
 input:{backgroundColor:c.surface2,borderRadius:14,paddingHorizontal:16,paddingVertical:13,fontSize:15,color:c.ink,marginBottom:10},
 row:{flexDirection:'row',alignItems:'center'},
});
