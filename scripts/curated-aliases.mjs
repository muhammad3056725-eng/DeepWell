// One-off generator: adds the everyday names players type for the biggest countries to data/overrides.json.
import { readFile, writeFile } from 'node:fs/promises';
const by = {
 "People's Republic of China":['China','PRC'], 'China':['PRC'],
 'United States':['USA','US','America','United States of America','U.S.','U.S.A.'],
 'United Kingdom':['UK','U.K.','Britain','Great Britain','United Kingdom of Great Britain and Northern Ireland'],
 'United Arab Emirates':['UAE','Emirates'], 'Czech Republic':['Czechia'], 'Czechia':['Czech Republic'],
 'Eswatini':['Swaziland'], 'Myanmar':['Burma'], 'Turkey':['Türkiye','Turkiye'], 'Netherlands':['Holland'],
 'Ivory Coast':["Côte d'Ivoire",'Cote d Ivoire'], "Côte d'Ivoire":['Ivory Coast'],
 'Democratic Republic of the Congo':['DRC','DR Congo','Congo Kinshasa'], 'Republic of the Congo':['Congo Brazzaville'],
 'Russia':['Russian Federation'], 'South Korea':['Korea','Republic of Korea'], 'North Korea':['DPRK'],
 'Vatican City':['Vatican','Holy See'], 'Cape Verde':['Cabo Verde'], 'East Timor':['Timor-Leste','Timor Leste'],
 'Bahamas':['The Bahamas'], 'Gambia':['The Gambia'], 'Macedonia':['North Macedonia'], 'North Macedonia':['Macedonia'],
};
const file='data/overrides.json',ov=JSON.parse(await readFile(file,'utf8'));
for(const id of ['country','country-asia','country-europe','country-africa','country-north-america','country-south-america','country-oceania']){ov[id]={...(ov[id]||{}),aliasByName:by};}
await writeFile(file,JSON.stringify(ov,null,1)+'\n');console.log('ok');
