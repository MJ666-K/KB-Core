import { db } from './db/client';
import { models } from './db/schema';
import { eq } from 'drizzle-orm';

async function fix() {
  const result = await db.update(models)
    .set({ 
      modelId: 'deepseek-v4-pro',
      updatedAt: new Date() 
    })
    .where(eq(models.name, 'deepseek-v4-pro'))
    .returning();
  
  if (result.length > 0) {
    console.log('✅ 已修复: deepseek-v4-pro → modelId: deepseek-v4-pro');
    console.log('Model ID:', result[0].id);
    console.log('Model ID (API):', result[0].modelId);
  } else {
    console.log('❌ 修复失败');
  }
}

fix().catch(console.error);
