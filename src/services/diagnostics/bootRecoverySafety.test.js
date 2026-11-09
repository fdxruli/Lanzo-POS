// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({busy:false,pending:[],checkouts:[],native:false,preflight:false,writes:false,draft:false,backup:false}));
vi.mock('../../store/useAppStore',()=>({useAppStore:{getState:()=>({_isInitializing:h.busy,isBackupLoading:h.backup})}}));
vi.mock('../auth/actorOperationalHandoff',()=>({getPendingActorOperations:()=>h.pending,getActorCheckoutOwnerships:()=>h.checkouts}));
vi.mock('../db/databaseRuntime',()=>({getLocalDatabaseActivitySnapshot:()=>({hasActiveNativeRequest:h.native,preflightActive:h.preflight})}));
vi.mock('../../pwa/adminUpdateSafety',()=>({hasAdminUpdateWrites:()=>h.writes,getAdminUpdateDraftBlockReason:()=>h.draft}));
import {getBootRetrySafety} from './bootRecoverySafety';
import {startBootProgress,setBootProgressPhase,finishBootProgress} from './bootProgress';
describe('safe in-place boot retry',()=>{
  beforeEach(()=>{Object.assign(h,{busy:false,pending:[],checkouts:[],native:false,preflight:false,writes:false,draft:false,backup:false});finishBootProgress();});
  it('only permits a retry without active work',()=>{expect(getBootRetrySafety()).toMatchObject({canRetry:true,canUpdate:true});startBootProgress();setBootProgressPhase('opening_database');expect(getBootRetrySafety()).toMatchObject({canRetry:false,reason:'bootstrap_active',phase:'opening_database'});});
  it('keeps persisted checkout guarded for updates but permits a non-destructive bootstrap',()=>{h.checkouts=[{persisted:true,orderId:'safe-but-unresolved'}];expect(getBootRetrySafety()).toMatchObject({canRetry:true,canUpdate:false,savedCheckouts:1});expect(h.checkouts[0].orderId).toBe('safe-but-unresolved');h.checkouts=[{persisted:false}];expect(getBootRetrySafety()).toMatchObject({canRetry:false,reason:'checkout_active'});});
  it.each([
    ['bootstrap',()=>{h.busy=true},'bootstrap_active'],
    ['pending operation',()=>{h.pending=[{}]},'operation_active'],
    ['native IndexedDB',()=>{h.native=true},'database_active'],
    ['preflight',()=>{h.preflight=true},'database_active'],
    ['database write',()=>{h.writes=true},'write_active'],
    ['draft',()=>{h.draft=true},'draft_active'],
    ['backup',()=>{h.backup=true},'backup_active']
  ])('fails closed on %s',(_label,arrange,reason)=>{arrange();expect(getBootRetrySafety()).toMatchObject({canRetry:false,reason});});
});
