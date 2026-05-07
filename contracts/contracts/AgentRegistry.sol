// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AgentRegistry is Ownable {
    mapping(address agent => bool authorized) private authorizedAgents;

    event AgentRegistered(address indexed agent);
    event AgentRevoked(address indexed agent);

    error InvalidAgent();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerAgent(address agent) external onlyOwner {
        if (agent == address(0)) {
            revert InvalidAgent();
        }

        authorizedAgents[agent] = true;
        emit AgentRegistered(agent);
    }

    function revokeAgent(address agent) external onlyOwner {
        if (agent == address(0)) {
            revert InvalidAgent();
        }

        authorizedAgents[agent] = false;
        emit AgentRevoked(agent);
    }

    function isAuthorized(address agent) external view returns (bool) {
        return authorizedAgents[agent];
    }
}
