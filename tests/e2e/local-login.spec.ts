import {test,expect} from '@playwright/test';

for(const host of ['localhost','127.0.0.1']) {
 test(`documented local launcher login on ${host}`,async({page})=>{
  await page.goto(`http://${host}:5173`);
  const login=page.waitForResponse(r=>r.url().includes('/auth/demo?mode=fleet')&&r.request().method()==='POST');
  await page.getByRole('button',{name:/Explore the demo fleet/}).click();
  expect((await login).status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Your fleet, at a glance.'})).toBeVisible();
  const run=page.waitForResponse(r=>r.url().endsWith('/simulation/runs')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Run scenario',exact:true}).click();
  expect((await run).status()).toBe(201);
  await expect(page.getByText('YAZ 001',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('Fuel compensation changed',{exact:true}).first()).toBeVisible({timeout:60000});
 });
}
