// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GrantRegistry
 * @dev Onchain time-limited grant and revocation registry for AI agent access to encrypted documents.
 * Designed for VaultMind on Monad Testnet.
 */
contract GrantRegistry {
    struct Grant {
        address agent;
        uint64 expiry;
        bool isRevoked;
        bool exists;
    }

    // Mapping: docId => owner address
    mapping(bytes32 => address) public documentOwners;

    // Mapping: docId => agent address => Grant struct
    mapping(bytes32 => mapping(address => Grant)) public grants;

    // Events
    event DocumentRegistered(bytes32 indexed docId, address indexed owner);
    event GrantCreated(bytes32 indexed docId, address indexed owner, address indexed agent, uint64 expiry);
    event GrantRevoked(bytes32 indexed docId, address indexed owner, address indexed agent);

    // Modifiers
    modifier onlyDocumentOwner(bytes32 docId) {
        address owner = documentOwners[docId];
        if (owner == address(0)) {
            // First time registering document
            documentOwners[docId] = msg.sender;
            emit DocumentRegistered(docId, msg.sender);
        } else {
            require(owner == msg.sender, "GrantRegistry: Caller is not the document owner");
        }
        _;
    }

    /**
     * @notice Register a document identifier under the caller's address.
     * @param docId Keccak-256 or unique bytes32 identifier of the document.
     */
    function registerDocument(bytes32 docId) external {
        require(docId != bytes32(0), "GrantRegistry: Invalid docId");
        address currentOwner = documentOwners[docId];
        if (currentOwner == address(0)) {
            documentOwners[docId] = msg.sender;
            emit DocumentRegistered(docId, msg.sender);
        } else {
            require(currentOwner == msg.sender, "GrantRegistry: Document already registered by another owner");
        }
    }

    /**
     * @notice Grant an AI agent time-limited access to a document.
     * @param docId The document identifier.
     * @param agent The public address representing the AI agent.
     * @param expiry Unix timestamp (in seconds) when access expires.
     */
    function grantAccess(bytes32 docId, address agent, uint64 expiry) external onlyDocumentOwner(docId) {
        require(agent != address(0), "GrantRegistry: Invalid agent address");
        require(expiry > block.timestamp, "GrantRegistry: Expiry must be in the future");

        grants[docId][agent] = Grant({
            agent: agent,
            expiry: expiry,
            isRevoked: false,
            exists: true
        });

        emit GrantCreated(docId, msg.sender, agent, expiry);
    }

    /**
     * @notice Revoke access for an AI agent immediately.
     * @param docId The document identifier.
     * @param agent The public address representing the AI agent.
     */
    function revokeAccess(bytes32 docId, address agent) external {
        require(documentOwners[docId] == msg.sender, "GrantRegistry: Only document owner can revoke");
        require(grants[docId][agent].exists, "GrantRegistry: No active grant found for this agent");
        require(!grants[docId][agent].isRevoked, "GrantRegistry: Grant is already revoked");

        grants[docId][agent].isRevoked = true;

        emit GrantRevoked(docId, msg.sender, agent);
    }

    /**
     * @notice Check whether an AI agent currently holds a valid, active grant for a document.
     * @param docId The document identifier.
     * @param agent The public address representing the AI agent.
     * @return active True if grant exists, is not revoked, and expiry > current block.timestamp.
     */
    function hasActiveGrant(bytes32 docId, address agent) external view returns (bool active) {
        Grant memory g = grants[docId][agent];
        if (!g.exists) return false;
        if (g.isRevoked) return false;
        if (g.expiry <= block.timestamp) return false;
        return true;
    }

    /**
     * @notice Fetch grant details for inspection.
     */
    function getGrant(bytes32 docId, address agent) external view returns (
        address docOwner,
        address grantedAgent,
        uint64 expiry,
        bool isRevoked,
        bool active
    ) {
        Grant memory g = grants[docId][agent];
        bool isActive = g.exists && !g.isRevoked && (g.expiry > block.timestamp);
        return (
            documentOwners[docId],
            g.agent,
            g.expiry,
            g.isRevoked,
            isActive
        );
    }
}
