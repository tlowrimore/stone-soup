import t from 'tap';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { StorageAsync } from '../../storage/storage-async';
import { onFinishOneTest } from '../browser-run-exit';
import {
  Crypto,
} from '../../crypto/crypto';
import { AuthorKeypair } from '../../util/doc-types';
import { StorageDriverLocalStorage } from '../../storage/storage-driver-local-storage';

(t.test as any)?.onFinish?.(() => onFinishOneTest('StorageDriverLocalStorage'));

let workspace = '+test.abc';

t.test('Persists', async (t: any) => {
  let storageDriver = new StorageDriverLocalStorage(workspace);
  let storage = new StorageAsync(workspace, FormatValidatorEs4, storageDriver);
  
  let keypair = Crypto.generateAuthorKeypair('suzy') as AuthorKeypair;
  
  await storage.set(keypair, {
    content: 'One',
    path: '/test/1',
    format: 'es.4',
  })
  
  await storage.set(keypair, {
    content: 'Two',
    path: '/test/2',
    format: 'es.4',
  })
  
  await storage.set(keypair, {
    content: 'Three',
    path: '/test/3',
    format: 'es.4',
  })
  
  t.same((await storage.getAllDocs()).length, 3)
  
  await storage.close()
  
  
})