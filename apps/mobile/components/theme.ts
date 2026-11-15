import {Platform,StyleSheet} from 'react-native';

/** Graphite + teal tokens. Kept in step with the web app's :root variables in apps/web/src/style.css. */
export const c={
 bg:'#f6f7f4',surface:'#ffffff',surface2:'#f9faf8',
 ink:'#14201f',ink2:'#34423f',muted:'#6b7774',faint:'#97a19d',
 line:'#e4e7e1',line2:'#eef0eb',
 teal:'#0f766e',teal600:'#0b5f58',teal50:'#e7f3f1',teal300:'#6cc4b8',
 amber:'#b45309',amber50:'#fdf3e4',red:'#b42318',red50:'#fdecea',green:'#15803d',green50:'#e8f5ec',
 hero:'#14201f',hero2:'#1c2b29',heroLine:'#2c3c3a',heroMuted:'#9fb0ac',
};

export const mono=Platform.OS==='ios'?'Menlo':'monospace';

/** Shared building blocks: cards, labels, buttons and chips. */
export const ui=StyleSheet.create({
 card:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line,borderRadius:18,padding:18,marginBottom:14},
 cardTitle:{fontSize:17,fontWeight:'700',color:c.ink,letterSpacing:-0.2,marginBottom:4},
 body:{fontSize:13.5,lineHeight:20,color:c.muted},
 label:{fontSize:11.5,fontWeight:'700',letterSpacing:1,color:c.muted,textTransform:'uppercase'},
 input:{borderWidth:1,borderColor:c.line,backgroundColor:c.surface2,borderRadius:12,paddingHorizontal:14,paddingVertical:12,fontSize:15,color:c.ink,marginBottom:10},
 button:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:c.teal,borderRadius:999,paddingVertical:14,paddingHorizontal:18,marginVertical:5},
 buttonText:{color:'#fff',fontSize:14.5,fontWeight:'700'},
 secondary:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line},
 secondaryText:{color:c.ink2},
 row:{flexDirection:'row',alignItems:'center'},
 divider:{height:1,backgroundColor:c.line2,marginVertical:12},
 chip:{flexDirection:'row',alignItems:'center',gap:6,alignSelf:'flex-start',borderRadius:999,paddingVertical:5,paddingHorizontal:10,backgroundColor:c.line2},
 chipText:{fontSize:12,fontWeight:'700',color:c.ink2},
 iconBox:{width:38,height:38,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:c.teal50},
});
