import { microsecondNow, randomId } from "../util/misc";
import {
  AllWorkspaceStates_Request,
  AllWorkspaceStates_Response,
  initialPeerClientState,
  IPeer,
  IRemotePeer,
  ISyncConnection,
  Peer_Request,
  Peer_Response,
  PeerClientState,
  PeerId_Response,
  saltAndHashWorkspace,
  SaltyHandshake_Response,
  WorkspaceState,
  WorkspaceStateFromServer,
  Ingest_Message,
} from "./peer-types";

import { Doc, WorkspaceAddress } from "../util/doc-types";
import { sortedInPlace } from "../storage/compare";
import { ValidationError } from "../util/errors";

export class SyncConnection implements ISyncConnection {
  peer: IPeer;
  otherPeer: IRemotePeer;
  state: PeerClientState = { ...initialPeerClientState };

  constructor(peer: IPeer, remotePeer: IRemotePeer) {
    this.peer = peer;
    this.otherPeer = remotePeer;

    this.otherPeer.establishConnection(this.onMessage);
    
    // TODO: Once connection is established...
    // 1. Get the peer id.
    // 2. Initiate salty handshake
    // 3. Get all workspace states
    // 4. Then using the information from workspace states,
    //    construct a new QueryFollower for each workspace
    //    and start pushing ingest messages, one by one...
  }
  
  close() {
    return this.otherPeer.closeConnection();
  }

  async setState(newState: Partial<PeerClientState>): Promise<void> {
    // if peerId changes, reset state
    if (newState.serverPeerId !== null && newState.serverPeerId !== undefined) {
      if (this.state.serverPeerId !== null) {
        if (newState.serverPeerId !== this.state.serverPeerId) {
          this.state = { ...initialPeerClientState };
        }
      }
    }
    this.state = { ...this.state, ...newState };
  }

  // register
  onMessage(message: Peer_Request | Peer_Response | Ingest_Message): Promise<void> {
    switch (message.kind) {
      case ("PEER_ID_REQUEST"):
        return this._respond_serverPeerId();
      case ("PEER_ID_RESPONSE"):
        return this._handle_serverPeerId(message);
      case ("SALTY_HANDSHAKE_REQUEST"):
        return this._respond_saltyHandshake();
      case ("SALTY_HANDSHAKE_RESPONSE"):
        return this._handle_saltyHandshake(message);
      case ("ALL_WORKSPACE_STATES_REQUEST"):
        return this._respond_allWorkspaceStates(message);
      case ("ALL_WORKSPACE_STATES_RESPONSE"):
        return this._handle_allWorkspaceStates(message);
      case ("INGEST_MESSAGE"):
        return this._handle_ingest(message);
      default:
        return Promise.reject();
    }
  }

  //--------------------------------------------------
  // GET SERVER PEER ID

  async _request_serverPeerId() {
    return this.otherPeer.sendMessage({ kind: "PEER_ID_REQUEST" });
  }

  async _respond_serverPeerId() {
    return this.otherPeer.sendMessage({
      kind: "PEER_ID_RESPONSE",
      peerId: this.peer.peerId,
    });
  }

  async _handle_serverPeerId(message: PeerId_Response) {
    return this.setState({
      serverPeerId: message.peerId,
      lastSeenAt: microsecondNow(),
    });
  }

  //--------------------------------------------------
  // SALTY HANDSHAKE

  // do the entire thing
  async _request_saltyHandshake() {
    return this.otherPeer.sendMessage({ kind: "SALTY_HANDSHAKE_REQUEST" });
  }

  async _respond_saltyHandshake() {
    let salt = randomId();
    let saltedWorkspaces = this.peer.workspaces().map((ws) =>
      saltAndHashWorkspace(salt, ws)
    );

    return this.otherPeer.sendMessage({
      kind: "SALTY_HANDSHAKE_RESPONSE",
      serverPeerId: this.peer.peerId,
      salt,
      saltedWorkspaces,
    });
  }

  async _handle_saltyHandshake(response: SaltyHandshake_Response) {
    let { serverPeerId, salt, saltedWorkspaces } = response;

    let serverSaltedSet = new Set<string>(saltedWorkspaces);
    let commonWorkspaceSet = new Set<WorkspaceAddress>();
    for (let plainWs of this.peer.workspaces()) {
      let saltedWs = saltAndHashWorkspace(salt, plainWs);
      if (serverSaltedSet.has(saltedWs)) {
        commonWorkspaceSet.add(plainWs);
      }
    }
    let commonWorkspaces = sortedInPlace([...commonWorkspaceSet]);

    return this.setState({
      serverPeerId,
      commonWorkspaces,
      lastSeenAt: microsecondNow(),
    });
  }

  //--------------------------------------------------
  // ALL STORAGE STATES

  async _request_allWorkspaceStates() {
    return this.otherPeer.sendMessage({
      kind: "ALL_WORKSPACE_STATES_REQUEST",
      commonWorkspaces: this.state.commonWorkspaces || [],
    });
  }

  async _respond_allWorkspaceStates(request: AllWorkspaceStates_Request) {
    let workspaceStatesFromServer: Record<
      WorkspaceAddress,
      WorkspaceStateFromServer
    > = {};
    for (let workspace of request.commonWorkspaces) {
      let storage = this.peer.getStorage(workspace);
      if (storage === undefined) {
        continue;
      }
      let workspaceStateFromServer: WorkspaceStateFromServer = {
        workspace: workspace,
        serverStorageId: storage.storageId,
        serverMaxLocalIndexOverall: storage.getMaxLocalIndex(),
      };
      workspaceStatesFromServer[workspace] = workspaceStateFromServer;
    }

    return this.otherPeer.sendMessage({
      kind: "ALL_WORKSPACE_STATES_RESPONSE",
      serverPeerId: this.peer.peerId,
      workspaceStatesFromServer,
    });
  }

  async _handle_allWorkspaceStates(response: AllWorkspaceStates_Response) {
    let { serverPeerId, workspaceStatesFromServer } = response;

    let newWorkspaceStates: Record<WorkspaceAddress, WorkspaceState> = {};
    for (let workspace of Object.keys(workspaceStatesFromServer)) {
      let workspaceStateFromServer = workspaceStatesFromServer[workspace];
      if (workspaceStateFromServer.workspace !== workspace) {
        throw new ValidationError(
          `server shenanigans: server response is not self-consistent, workspace key does not match data in the Record ${workspaceStateFromServer.workspace} & ${workspace}`,
        );
      }

      let clientStorage = this.peer.getStorage(workspace);
      if (clientStorage === undefined) {
        throw new ValidationError(
          `server shenanigans: referenced a workspace we don't have: ${workspace}`,
        );
      }
      let existingWorkspaceState = this.state.workspaceStates[workspace] || {};
      newWorkspaceStates[workspace] = {
        workspace,

        serverStorageId: workspaceStateFromServer.serverStorageId,
        serverMaxLocalIndexOverall:
          workspaceStateFromServer.serverMaxLocalIndexOverall,
        // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
        serverMaxLocalIndexSoFar:
          existingWorkspaceState.serverMaxLocalIndexSoFar ?? -1,

        // TODO: check if client storage id has changed, and if so reset this state
        clientStorageId: clientStorage.storageId,
        clientMaxLocalIndexOverall: clientStorage.getMaxLocalIndex(),
        // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
        clientMaxLocalIndexSoFar:
          existingWorkspaceState.clientMaxLocalIndexSoFar ?? -1,

        lastSeenAt: microsecondNow(),
      };
    }

    return this.setState({
      serverPeerId,
      // TODO: should this merge with, or overwrite, the existing one?
      // we've incorporated the existing one into this one already, so we should
      // have checked if the serverPeerId has changed also...
      workspaceStates: newWorkspaceStates,
      lastSeenAt: microsecondNow(),
    });
  }

  //--------------------------------------------------
  // INGEST DOC
  
  async _message_ingest(doc: Doc): Promise<void> {
    this.otherPeer.sendMessage({
      kind: 'INGEST_MESSAGE',
      doc
    })
  }
  
  async _handle_ingest(message: Ingest_Message) {
    const { doc } = message;
    
    let storage = this.peer.getStorage(doc.workspace);
    if (storage === undefined) {
      let err = `workspace ${doc.workspace} is unknown; skipping`;

      throw err;
    }

    let myWorkspaceState = this.state.workspaceStates[doc.workspace];
    
    await storage.ingest(doc);
    
    myWorkspaceState = {
      ...myWorkspaceState,
      serverMaxLocalIndexSoFar: doc._localIndex ?? -1,
      lastSeenAt: microsecondNow(),
    };
    return this.setState({
      workspaceStates: {
        ...this.state.workspaceStates,
        [doc.workspace]: myWorkspaceState,
      },
      lastSeenAt: microsecondNow(),
    });
    
  }
}
