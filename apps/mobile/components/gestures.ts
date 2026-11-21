/**
 * Where a flick was headed: the distance a finger's release velocity (px/s) would still carry it, decaying the way
 * iOS scroll views do. Lets a quick short swipe commit while a slow long drag does not.
 */
export function project(velocity:number,decelerationRate=0.998){
 'worklet';
 return ((velocity/1000)*decelerationRate)/(1-decelerationRate);
}

/** Past an edge the element follows less and less, instead of stopping dead. */
export function rubberband(overshoot:number,dimension:number,constant=0.55){
 'worklet';
 return (overshoot*dimension*constant)/(dimension+constant*Math.abs(overshoot));
}
