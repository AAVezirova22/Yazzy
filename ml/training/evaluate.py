"""Reproducible synthetic benchmark; cannot validate real-car diagnostic accuracy.

No production model promotion, no failure labels, and no failure probabilities.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import balanced_accuracy_score, mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def dataset(seed=42):
    rng=np.random.default_rng(seed)
    rows=[]
    for vehicle in range(40):
        for day in range(45):
            speed=rng.uniform(0,90)
            stop=rng.uniform(0,500)
            ignition=int(rng.random()>.25)
            duration=rng.uniform(300,3600)
            idle=rng.uniform(0,.4)*duration
            distance=speed*(duration-idle)/3600
            temp=rng.uniform(-5,35)
            fuel=.065*distance+idle*.00022+max(0,15-temp)*.002+rng.normal(0,.02)
            state='MOVING' if speed>5 else 'PARKED_END' if stop>180 and not ignition else 'TEMPORARY_STOP'
            rows.append({'vehicle':vehicle,'day':day,'speed':speed,'stop':stop,'ignition':ignition,
                         'distance':distance,'idle':idle,'temperature':temp,'fuel':max(0,fuel),'state':state})
    return rows


def evaluate(output:Path):
    rows=dataset()
    # Split by vehicle AND time before fitting any preprocessing.
    train=[r for r in rows if r['vehicle']<28 and r['day']<25]
    validation=[r for r in rows if 28<=r['vehicle']<34 and 25<=r['day']<35]
    test=[r for r in rows if r['vehicle']>=34 and r['day']>=35]
    assert not ({r['vehicle'] for r in train}&{r['vehicle'] for r in test})
    features=['distance','idle','temperature']
    x=lambda data:np.array([[r[f] for f in features] for r in data])
    y=lambda data:np.array([r['fuel'] for r in data])
    model=make_pipeline(SimpleImputer(),StandardScaler(),Ridge(alpha=1))
    model.fit(x(train),y(train))
    constant=DummyRegressor().fit(x(train),y(train))
    analytic=lambda data:np.array([.065*r['distance']+.00022*r['idle']+max(0,15-r['temperature'])*.002 for r in data])
    trip_features=lambda data:np.array([[r['speed'],r['stop'],r['ignition']] for r in data])
    classifier=HistGradientBoostingClassifier(max_iter=30,random_state=42,min_samples_leaf=5)
    classifier.fit(trip_features(train),[r['state'] for r in train])
    result={'schemaVersion':1,'origin':'SIMULATED','seed':42,'featureVersion':'trip-context-v1',
            'dataSha256':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),
            'splits':{'train':len(train),'validation':len(validation),'test':len(test),'vehicleDisjoint':True,'timeOrdered':True},
            'fuel':{'ridgeTestMAE_L':mean_absolute_error(y(test),model.predict(x(test))),
                    'constantTestMAE_L':mean_absolute_error(y(test),constant.predict(x(test))),
                    'knownSyntheticRuleMAE_L':mean_absolute_error(y(test),analytic(test))},
            'tripState':{'modelBalancedAccuracy':balanced_accuracy_score([r['state'] for r in test],classifier.predict(trip_features(test))),
                         'generatorRuleAccuracy':1.0},
            'promotion':'REJECTED_RESEARCH_ONLY','realVehicleValidation':False,'failureForecastAvailable':False,
            'limitations':['Labels follow generator rules; perfect rule performance is expected.','No independent repair outcomes or held-out real vehicles.','This report tests the pipeline, not automotive diagnostic accuracy.']}
    output.mkdir(parents=True,exist_ok=True)
    (output/'synthetic-evaluation.json').write_text(json.dumps(result,indent=2)+'\n')
    (output/'split-manifest.json').write_text(json.dumps({name:[{'vehicle':r['vehicle'],'day':r['day']} for r in split] for name,split in [('train',train),('validation',validation),('test',test)]},indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('evaluation'));evaluate(p.parse_args().output)
