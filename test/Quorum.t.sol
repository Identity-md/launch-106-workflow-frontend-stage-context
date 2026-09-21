// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Quorum} from "../src/Quorum.sol";

contract QuorumTest {
    function testFixedSupplyAndMetadata() public {
        Quorum token = new Quorum();
        require(token.totalSupply() == 1_000_000_000 ether);
        require(token.balanceOf(address(this)) == token.totalSupply());
        require(token.decimals() == 18);
        require(keccak256(bytes(token.name())) == keccak256("Quorum"));
        require(keccak256(bytes(token.symbol())) == keccak256("QRM"));
    }

    function testTransferAndAllowance() public {
        Quorum token = new Quorum();
        TokenSpender spender = new TokenSpender();
        token.approve(address(spender), 20);
        spender.spend(token, address(this), address(0xBEEF), 20);
        require(token.balanceOf(address(0xBEEF)) == 20);
        require(token.allowance(address(this), address(spender)) == 0);
    }
}

contract TokenSpender {
    function spend(Quorum token, address from, address to, uint256 amount) external {
        require(token.transferFrom(from, to, amount));
    }
}
