import { IRemotePeer, Peer_Request, Peer_Response } from "./peer-types";

// You can imagine a mirror PeerConnection with a WebsocketServerPeer
// being created when a PeerConnection with the below RemotePeer
// is created.

export class WebsocketRemotePeer implements IRemotePeer {
  url: string
  wsConnection: WebSocket | undefined
  
  constructor(url: string) {
    this.url = url
  }
  
  establishConnection(onMessage: (message: Peer_Request | Peer_Response) => void) {
    this.wsConnection =  new WebSocket(this.url);
  
    this.wsConnection.onmessage = (event) => {
      try {
        const parsedMessage = JSON.parse(event.data);
        
        onMessage(parsedMessage);
      } catch(error) {
        // What should be done when an error happens?
      }
    }
  }
  
  closeConnection() {
    this.wsConnection?.close();
  }
  
  readyState() {
    switch (this.wsConnection?.readyState) {
      case (0):
        return 'Connecting';
      case (1):
        return 'Open';
      case (2):
        return 'Closing'
      default:
        return 'Closed'
    }
  }
  
  sendMessage(peerMessage: Peer_Request | Peer_Response) {
    return new Promise<void>((resolve, reject) => {
      try {
        const stringified = JSON.stringify(peerMessage)
      
        if (!this.wsConnection) {
          return reject();
        }
        
        this.wsConnection.send(stringified);
        return resolve();
      } catch (error) {
        return reject(error)
      }
    })    
  }
  
  
}