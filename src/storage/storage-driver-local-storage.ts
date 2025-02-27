import { Doc, Path, WorkspaceAddress } from "../util/doc-types.ts";
import { StorageIsClosedError } from "../util/errors.ts";
import { StorageDriverAsyncMemory } from "./storage-driver-async-memory.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("storage driver localStorage", "yellowBright");

//================================================================================
type SerializedDriverDocs = {
    byPathAndAuthor: Record<string, Doc>;
    byPathNewestFirst: Record<Path, Doc[]>;
};

function isSerializedDriverDocs(value: any): value is SerializedDriverDocs {
    // check if data we've loaded from localStorage is actually in the format we expect
    if (typeof value !== "object") {
        return false;
    }
    return ("byPathAndAuthor" in value && "byPathNewestFirst" in value);
}

export class StorageDriverLocalStorage extends StorageDriverAsyncMemory {
    _localStorageKeyConfig: string;
    _localStorageKeyDocs: string;

    constructor(workspace: WorkspaceAddress) {
        super(workspace);
        logger.debug("constructor");

        // each config item starts with this prefix and gets its own entry in localstorage
        this._localStorageKeyConfig = `stonesoup:config:${workspace}`; // TODO: change this to "earthstar:..." later
        // but all docs are stored together inside this one item, as a giant JSON object
        this._localStorageKeyDocs = `stonesoup:documents:pathandauthor:${workspace}`;

        let existingData = localStorage.getItem(this._localStorageKeyDocs);
        if (existingData !== null) {
            logger.debug("...constructor: loading data from localStorage");
            let parsed = JSON.parse(existingData);

            if (!isSerializedDriverDocs(parsed)) {
                console.warn(
                    `localStorage data could not be parsed for workspace ${workspace}`,
                );
                return;
            }

            this.docByPathAndAuthor = new Map(
                Object.entries(parsed.byPathAndAuthor),
            );
            this.docsByPathNewestFirst = new Map(
                Object.entries(parsed.byPathNewestFirst),
            );
        } else {
            logger.debug(
                "...constructor: there was no existing data in localStorage",
            );
        }
        logger.debug("...constructor is done.");
    }

    //--------------------------------------------------
    // LIFECYCLE

    // isClosed(): inherited
    close(erase: boolean) {
        logger.debug("close");
        if (this._isClosed) throw new StorageIsClosedError();
        if (erase) {
            logger.debug("...close: and erase");
            this._configKv = {};
            this._maxLocalIndex = -1;
            this.docsByPathNewestFirst.clear();
            this.docByPathAndAuthor.clear();

            logger.debug("...close: erasing localStorage");
            localStorage.removeItem(this._localStorageKeyDocs);
            for (let key of this._listConfigKeysSync()) {
                this._deleteConfigSync(key);
            }
            logger.debug("...close: erasing is done");
        }
        this._isClosed = true;
        logger.debug("...close is done.");

        return Promise.resolve();
    }

    //--------------------------------------------------
    // CONFIG

    // synchronous versions for internal use

    _getConfigSync(key: string): string | undefined {
        if (this._isClosed) throw new StorageIsClosedError();
        key = `${this._localStorageKeyConfig}:${key}`;
        let result = localStorage.getItem(key);
        return result === null ? undefined : result;
    }

    _setConfigSync(key: string, value: string): void {
        if (this._isClosed) throw new StorageIsClosedError();
        key = `${this._localStorageKeyConfig}:${key}`;
        localStorage.setItem(key, value);
    }

    _listConfigKeysSync(): string[] {
        if (this._isClosed) throw new StorageIsClosedError();
        let keys = Object.keys(localStorage)
            .filter((key) => key.startsWith(this._localStorageKeyConfig + ":"))
            .map((key) => key.slice(this._localStorageKeyConfig.length + 1));
        keys.sort();
        return keys;
    }

    _deleteConfigSync(key: string): boolean {
        if (this._isClosed) throw new StorageIsClosedError();
        let hadIt = this._getConfigSync(key);
        key = `${this._localStorageKeyConfig}:${key}`;
        localStorage.removeItem(key);
        return hadIt !== undefined;
    }

    // async versions to match the IStorageDriverAsync interface

    async getConfig(key: string): Promise<string | undefined> {
        return this._getConfigSync(key);
    }
    async setConfig(key: string, value: string): Promise<void> {
        return this._setConfigSync(key, value);
    }
    async listConfigKeys(): Promise<string[]> {
        return this._listConfigKeysSync();
    }
    async deleteConfig(key: string): Promise<boolean> {
        return this._deleteConfigSync(key);
    }

    //--------------------------------------------------
    // GET

    // getMaxLocalIndex(): inherited
    // queryDocs(query: Query): inherited

    //--------------------------------------------------
    // SET

    async upsert(doc: Doc): Promise<Doc> {
        if (this._isClosed) throw new StorageIsClosedError();
        let upsertedDoc = await super.upsert(doc);

        // After every upsert, for now, we save everything
        // to localStorage as a single giant JSON blob.
        // TODO: debounce this, only do it every 1 second or something

        const docsToBeSerialised: SerializedDriverDocs = {
            byPathAndAuthor: Object.fromEntries(this.docByPathAndAuthor),
            byPathNewestFirst: Object.fromEntries(this.docsByPathNewestFirst),
        };

        localStorage.setItem(
            this._localStorageKeyDocs,
            JSON.stringify(docsToBeSerialised),
        );

        return upsertedDoc;
    }
}
