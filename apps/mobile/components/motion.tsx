import {useState,type ReactNode} from 'react';
import {Pressable,type PressableProps,type StyleProp,type ViewStyle} from 'react-native';
import Animated,{cubicBezier,Easing,ReduceMotion,useReducedMotion} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {motion} from './theme';

export const EASE_OUT=Easing.bezier(...motion.easeOut);
export const EASE_IN_OUT=Easing.bezier(...motion.easeInOut);
// Reanimated CSS transitions only take a predefined name or this helper; a 'cubic-bezier(...)' string throws.
const PRESS_CURVE=cubicBezier(...motion.easeOut);
/** Springs for anything a finger releases. Pass the gesture's velocity in, so the hand-off has no seam. */
export const SPRING={
 snap:{...motion.snap,reduceMotion:ReduceMotion.System},
 sheet:{...motion.sheet,reduceMotion:ReduceMotion.System},
 settle:{...motion.settle,reduceMotion:ReduceMotion.System},
};

/** Haptics are a garnish, never the only feedback: each call is one semantic event (a snap, a commit, a step). */
export const haptic={
 step:()=>{void Haptics.selectionAsync().catch(()=>{});},
 snap:()=>{void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});},
};

const AnimatedPressable=Animated.createAnimatedComponent(Pressable);

type Props=Omit<PressableProps,'style'|'children'>&{style?:StyleProp<ViewStyle>;children:ReactNode;
 /** A selection tick on press: quick actions and tab-like choices only. */
 tick?:boolean;
 /** Scale on press; 0.97 for cards and buttons, a little more for small round buttons. */
 scale?:number};

/**
 * Press feedback for every tappable surface. It shrinks 3% the moment a finger lands (feedback before the tap
 * completes, which is the latency people feel) and springs back on release, as a Reanimated CSS transition on the
 * UI thread. With Reduce Motion it dims instead of scaling.
 */
export function PressableScale({style,children,tick,scale=motion.press.scale,onPress,onPressIn,onPressOut,disabled,...rest}:Props){
 const [pressed,setPressed]=useState(false),reduced=useReducedMotion(),down=pressed&&!disabled;
 return <AnimatedPressable {...rest} disabled={disabled} pressRetentionOffset={16}
  onPressIn={e=>{setPressed(true);onPressIn?.(e);}} onPressOut={e=>{setPressed(false);onPressOut?.(e);}}
  onPress={e=>{if(tick)haptic.step();onPress?.(e);}}
  style={[style,{
   transform:[{scale:down&&!reduced?scale:1}],
   transitionProperty:'transform',transitionDuration:motion.press.duration,transitionTimingFunction:PRESS_CURVE,
  } as any,down&&reduced&&{opacity:0.8}]}>
  {children}
 </AnimatedPressable>;
}
