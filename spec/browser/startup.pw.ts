import {test,expect} from '@playwright/test';

test('late clock calibration preserves the sound button a keyboard user has already focused',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const page=await context.newPage();
    // Hold startup calibration behind the live UI so the former focus race
    // happens deterministically rather than only on one fast keyboard run.
    await page.route('**/api/time',async route=>{
      await new Promise(resolve=>setTimeout(resolve,300));
      await route.continue();
    });
    await page.goto('/');await page.getByRole('button',{name:'Start a mix',exact:true}).click();await page.waitForURL(/\/p\//);
    const add=page.getByRole('button',{name:'Add and play Pocket',exact:true});
    await expect(add).toBeEnabled();await add.focus();
    // This probe is installed only after all five calibration replies.
    await expect.poll(()=>page.evaluate(()=>!!(window as any).ensembleDebug)).toBe(true);
    await expect(add).toBeFocused();await page.keyboard.press('Enter');
    await expect(page.locator('.performer[data-part]')).toHaveCount(1);
  }finally{await context.close();}
});
