// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

contract IntentBatcher is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct TransferIntent {
        address token;
        address from;
        address to;
        uint256 amount;
        bytes32 userOpHash;
    }

    AgentRegistry public registry;

    event RegistryUpdated(address indexed registry);
    event IntentExecuted(
        uint256 indexed index,
        bytes32 indexed userOpHash,
        address indexed token,
        address from,
        address to,
        uint256 amount
    );
    event BatchExecuted(address indexed agent, uint256 intentCount, uint256 gasUsed);

    error UnauthorizedAgent(address agent);
    error EmptyBatch();
    error InvalidIntent(uint256 index);
    error InvalidRegistry();

    constructor(address initialOwner, AgentRegistry initialRegistry) Ownable(initialOwner) {
        registry = initialRegistry;
        emit RegistryUpdated(address(initialRegistry));
    }

    modifier onlyAuthorizedAgent() {
        if (!registry.isAuthorized(msg.sender)) {
            revert UnauthorizedAgent(msg.sender);
        }
        _;
    }

    function setRegistry(AgentRegistry newRegistry) external onlyOwner {
        if (address(newRegistry) == address(0)) {
            revert InvalidRegistry();
        }

        registry = newRegistry;
        emit RegistryUpdated(address(newRegistry));
    }

    function executeBatch(TransferIntent[] calldata intents)
        external
        nonReentrant
        onlyAuthorizedAgent
        returns (uint256 gasUsed)
    {
        uint256 startGas = gasleft();
        uint256 count = intents.length;

        if (count == 0) {
            revert EmptyBatch();
        }

        for (uint256 i = 0; i < count; i++) {
            TransferIntent calldata intent = intents[i];

            if (
                intent.token == address(0) || intent.from == address(0) || intent.to == address(0)
                    || intent.amount == 0
            ) {
                revert InvalidIntent(i);
            }

            IERC20(intent.token).safeTransferFrom(intent.from, intent.to, intent.amount);

            emit IntentExecuted(i, intent.userOpHash, intent.token, intent.from, intent.to, intent.amount);
        }

        gasUsed = startGas - gasleft();
        emit BatchExecuted(msg.sender, count, gasUsed);
    }
}
