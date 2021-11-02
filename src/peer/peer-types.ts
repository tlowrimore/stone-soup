import { Doc, WorkspaceAddress } from '../util/doc-types';
import { IStorageAsync, StorageId } from '../storage/storage-types';
import { Query } from '../query/query-types';
import { Crypto } from '../crypto/crypto';
import { Thunk } from '..';

//================================================================================
// PEER

export type PeerId = string;

export interface IPeer {
    // TODO: oops, or should we have storage IDs instead of peer IDs?
    peerId: PeerId,

    // getters
    hasWorkspace(workspace: WorkspaceAddress): boolean;
    workspaces(): WorkspaceAddress[];
    storages(): IStorageAsync[];
    size(): number;
    getStorage(ws: WorkspaceAddress): IStorageAsync | undefined;

    // setters
    addStorage(storage: IStorageAsync): Promise<void>;
    removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void> 
    removeStorage(storage: IStorageAsync): Promise<void>;
}



//================================================================================
type ConnectionState = 'Connecting' | 'Open' | 'Closing' | 'Closed'

export interface IRemotePeer {
    // Teach this class to establish a connection with a remote peer
    establishConnection(onMessage: (message: Peer_Request | Peer_Response | Ingest_Message) => Promise<void>): void
    
    // Teach this class how to send a message to the other peer
    sendMessage(peerMessage: Peer_Request | Peer_Response | Ingest_Message): Promise<void>,
    
    readyState(): ConnectionState,
    closeConnection(): void
}

export interface ISyncConnection {
    peer: IPeer,
    otherPeer: IRemotePeer,
    
    close(): void
    
    // get and return the server's peerId.
    // this is small and simple and it be used as a ping to check if the server is online.
    _request_serverPeerId(): Promise<void>;
    _respond_serverPeerId(message: PeerId_Request): Promise<void>;
    _handle_serverPeerId(message: PeerId_Response): Promise<void>;

    // figure out workspaces we have in common
    // do_: launches the request, runs handle_, and updates our state with the result
    _request_saltyHandshake(): Promise<void>;
    _respond_saltyHandshake(message: SaltyHandshake_Request): Promise<void>;
    _handle_saltyHandshake(message: SaltyHandshake_Response): Promise<void>;

    // get workspace states from the server (localIndex numbers)
    // do_: launches the request, runs handle_, and updates our state with the result
    _request_allWorkspaceStates(): Promise<void>;
    _respond_allWorkspaceStates(message: AllWorkspaceStates_Request): Promise<void>;
    _handle_allWorkspaceStates(message: AllWorkspaceStates_Response): Promise<void>;
    
    // push a doc to the other peer for ingestion
    _message_ingest(doc: Doc): Promise<void>
    _handle_ingest(message: Ingest_Message): Promise<void>
}

//================================================================================
// CLIENT AND SERVER

/**
 * API endpoints follow some similar patterns:
 * 
 * ## Do, Serve, Handle
 * 
 *   - Client always initiates contact.
 *   - client_do_thing(thing_request) => void -- handles all the following calls:
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.handle_thing(thing_response) => newState
 *   -     client.setState(newState)
 *
 *    FUNCTION             DATA TYPE
 * 
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.handle_x    
 *                         Partial<PeerClientState>
 * 
 * ## Do, Serve, Process
 *
 * This is used when the client needs to perform some side-effects besides just
 * updating its own client state.  For example, ingesting docs.  It also lets
 * the overall return value of process_x and do_x be something more useful,
 * like the number of docs ingested.
 *  
 *   - client_do_thing(thing_request) => ? -- handles all the following calls:
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.process_thing(thing_response) => ?
 * 
 *    FUNCTION             DATA TYPE
 * 
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.process_x
 *                         ? 
 */

// ok this isn't a type, but I put it here anyway since it's shared code for client and server
export let saltAndHashWorkspace = (salt: string, workspace: WorkspaceAddress): string =>
    Crypto.sha256base32(salt + workspace + salt);

//--------------------------------------------------
// PEER ID
export type PeerId_Request = {
    kind: 'PEER_ID_REQUEST'
}

export type PeerId_Response = {
    kind: 'PEER_ID_RESPONSE',
    peerId: string
}

//--------------------------------------------------
// SALTY HANDSHAKE

export interface SaltyHandshake_Request {
    kind: 'SALTY_HANDSHAKE_REQUEST'
}
export interface SaltyHandshake_Response {
    kind: 'SALTY_HANDSHAKE_RESPONSE'
    serverPeerId: PeerId,
    salt: string,
    saltedWorkspaces: string[],
}

//--------------------------------------------------
// ask server for all storage states

export interface AllWorkspaceStates_Request {
    kind: 'ALL_WORKSPACE_STATES_REQUEST'
    commonWorkspaces: WorkspaceAddress[],
}
export type AllWorkspaceStates_Response = {
    kind: 'ALL_WORKSPACE_STATES_RESPONSE'
    serverPeerId: PeerId,
    workspaceStatesFromServer: Record<WorkspaceAddress, WorkspaceStateFromServer>;
}
export type AllWorkspaceStates_Outcome = Record<WorkspaceAddress, WorkspaceState>;

//--------------------------------------------------
// push docs to other peer
export interface Ingest_Message {
    kind: 'INGEST_MESSAGE',
    doc: Doc,
}

export type Peer_Request = PeerId_Request | PeerId_Response | SaltyHandshake_Request | AllWorkspaceStates_Request;

export type Peer_Response = SaltyHandshake_Response | AllWorkspaceStates_Response;

//--------------------------------------------------

// Data we learn from talking to the server.
// Null means not known yet.
// This should be easily serializable.
export interface PeerClientState {
    serverPeerId: PeerId | null;
    // TODO: commonWorkspaces could be merged with storageSyncStates?
    commonWorkspaces: WorkspaceAddress[] | null;
    workspaceStates: Record<WorkspaceAddress, WorkspaceState>;
    lastSeenAt: number | null,  // a timestamp in Earthstar-style microseconds
}
export interface WorkspaceStateFromServer {
    workspace: WorkspaceAddress,
    serverStorageId: StorageId;
    serverMaxLocalIndexOverall: number,
}
export interface WorkspaceState {
    workspace: WorkspaceAddress,
    serverStorageId: StorageId;
    serverMaxLocalIndexOverall: number,
    serverMaxLocalIndexSoFar: number,  // -1 if unknown
    clientStorageId: StorageId;
    clientMaxLocalIndexOverall: number,
    clientMaxLocalIndexSoFar: number,  // -1 if unknown
    lastSeenAt: number,
}

export let initialPeerClientState: PeerClientState = {
    serverPeerId: null,
    commonWorkspaces: null,
    workspaceStates: {},
    lastSeenAt: null,
}