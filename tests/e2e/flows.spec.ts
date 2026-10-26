import {test,expect} from '@playwright/test';

test('fleet evidence, advisor confirmation, quote, export and navigation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message)});
 await page.goto('/');await page.getByRole('button',{name:/Explore the demo fleet/}).click();
 await expect(page.getByRole('heading',{name:'Your fleet, at a glance.'})).toBeVisible();
 await expect(page.getByText('YAZ 001',{exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/fleet-overview.png',fullPage:true});
 await page.getByRole('button',{name:/Health & alerts/}).click();
 await expect(page.getByText('Fuel compensation increased in comparable warm-idle windows.',{exact:true})).toBeVisible();
 await expect(page.getByText('INSPECTION RECOMMENDED',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Advisor',exact:true}).click();
 await page.getByRole('button',{name:'Prepare an inspection work order'}).click();
 await expect(page.getByRole('button',{name:'Confirm work order',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Confirm work order',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Work order confirmed'})).toBeVisible();
 await page.getByLabel('Description',{exact:true}).fill('Replace thermostat');
 await page.getByLabel('Verified total (€)').fill('400');
 await page.getByRole('button',{name:'Review evidence',exact:true}).click();
 await expect(page.getByText('REQUIRES ADDITIONAL DIAGNOSTIC EVIDENCE',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Maintenance',exact:true}).click();
 await page.getByRole('button',{name:'Start inspection'}).first().click();
 await expect(page.getByRole('button',{name:'Mark completed'}).first()).toBeVisible();
 await page.getByRole('button',{name:'Trips',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Trips & stationary sessions'})).toBeVisible();
 await page.locator('summary').first().click();
 await expect(page.getByText(/Distance: OBD_SPEED/).first()).toBeVisible();
 await page.getByRole('button',{name:'Vehicles',exact:true}).click();
 await page.getByLabel('Telemetry signal').selectOption('ENGINE_RPM');
 await expect(page.getByRole('img',{name:/Observed rpm/})).toBeVisible();
 await page.getByLabel('Search vehicles').fill('YAZ 004');
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'Reports',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download scoped CSV'}).click();
 expect((await download).suggestedFilename()).toBe('yazzy-vehicle-report.csv');
 expect(errors).toEqual([]);
});

test('personal garage keeps real data empty and saves vehicle and fuel',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Start my garage/}).click();
 await expect(page.getByText('My first car',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add vehicle',exact:true}).click();
 await page.getByLabel('Vehicle name').fill('Test Golf');await page.getByLabel('Make',{exact:true}).fill('Volkswagen');await page.getByLabel('Model',{exact:true}).fill('Golf');
 await page.getByRole('button',{name:'Save record'}).click();
 await expect(page.getByText('Test Golf',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Vehicles',exact:true}).click();
 await page.getByRole('button',{name:'Add fuel purchase'}).click();
 await page.getByLabel('Litres',{exact:true}).fill('40');await page.getByLabel('Total paid (€)').fill('65');await page.getByLabel('Odometer (km)').fill('100000');
 await page.getByRole('button',{name:'Save record'}).click();
 await expect(page.getByText('40 L',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Advisor',exact:true}).click();await page.getByRole('button',{name:'Will my battery fail tomorrow?'}).click();
 await expect(page.getByText('INSUFFICIENT DATA',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Personal owner Local development/}).click();
 await expect(page.getByRole('button',{name:/Explore the demo fleet/})).toBeVisible();
 await page.getByRole('button',{name:/Explore the demo fleet/}).click();
 await expect(page.getByText('YAZ 001',{exact:true})).toBeVisible();
 await expect(page.getByText('Test Golf',{exact:true})).toHaveCount(0);
});

test('mobile viewport has no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:/Explore the demo fleet/}).click();
 await expect(page.getByRole('heading',{name:'Your fleet, at a glance.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/mobile-web.png',fullPage:true});
});
