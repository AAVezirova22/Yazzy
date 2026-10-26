"""Validate a locally obtained, licensed canonical CSV without downloading or redistributing raw data."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

REQUIRED={'vehicle_id','session_id','observed_at','signal','value','unit'}


def prepare(path,manifest_path,output):
    manifest=json.loads(manifest_path.read_text())
    for field in ['source','license','citation','permittedUse','origin','sha256','namespace','schemaVersion']:
        if not manifest.get(field):raise ValueError('Missing provenance: '+field)
    checksum=hashlib.sha256(path.read_bytes()).hexdigest()
    if checksum!=manifest['sha256']:raise ValueError('Checksum mismatch')
    if manifest['origin']=='SIMULATED' and not manifest.get('allowSyntheticResearch',False):
        raise ValueError('Synthetic inputs require an isolated opt-in research experiment')
    rows=0;missing=0;vehicles=set();signals={}
    with path.open(newline='') as stream:
        reader=csv.DictReader(stream)
        if not REQUIRED.issubset(reader.fieldnames or []):raise ValueError('Canonical CSV schema mismatch; write a dataset-specific semantic adapter first')
        for row in reader:
            rows+=1;missing+=not row['value'];vehicles.add(row['vehicle_id']);signals[row['signal']]=signals.get(row['signal'],0)+1
    report={'sha256':checksum,'rows':rows,'vehicles':len(vehicles),'missingValues':missing,'signals':signals,'namespace':manifest['namespace'],'origin':manifest['origin'],'labelProvenance':manifest.get('labelProvenance','NO_CONFIRMED_OUTCOMES')}
    output.mkdir(parents=True,exist_ok=True);(output/'quality-report.json').write_text(json.dumps(report,indent=2))
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('csv',type=Path);p.add_argument('manifest',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(prepare(a.csv,a.manifest,a.output))
