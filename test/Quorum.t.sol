// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Quorum} from "../src/Quorum.sol";

import {TestBase} from "./CommitRevealVote.t.sol";

contract QuorumTest is TestBase {
    function testFixedSupplyAndMetadata() public {
        Quorum token = new Quorum();
        require(token.totalSupply() == 1_000_000_000 ether);
        require(token.balanceOf(address(this)) == token.totalSupply());
        require(token.decimals() == 18);
        require(keccak256(bytes(token.name())) == keccak256("Quorum"));
        require(keccak256(bytes(token.symbol())) == keccak256("QRM"));
    }

    function testZeroRecipientAndInsufficientBalanceRevert() public {
        Quorum token = new Quorum();
        uint256 supply = token.totalSupply();
        vm.expectRevert(bytes("ERC20: zero recipient"));
        token.transfer(address(0), 1);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        token.transfer(address(0xBEEF), supply + 1);
        assertEq(token.balanceOf(address(this)), supply);
        assertEq(token.balanceOf(address(0)), 0);
        assertEq(token.balanceOf(address(0xBEEF)), 0);
    }

    function testSelfTransferPreservesBalanceAndInfiniteAllowance() public {
        Quorum token = new Quorum();
        TokenSpender spender = new TokenSpender();
        uint256 supply = token.totalSupply();
        token.transfer(address(this), supply);
        assertEq(token.balanceOf(address(this)), supply);
        token.approve(address(spender), type(uint256).max);
        spender.spend(token, address(this), address(this), 20);
        assertEq(token.balanceOf(address(this)), supply);
        spender.spend(token, address(this), address(0xBEEF), 20);
        assertEq(token.balanceOf(address(this)), supply - 20);
        assertEq(token.balanceOf(address(0xBEEF)), 20);
        assertEq(token.allowance(address(this), address(spender)), type(uint256).max);
        assertEq(token.totalSupply(), supply);
    }

    function testTransferFromFailuresRollBackAllowance() public {
        Quorum token = new Quorum();
        TokenSpender spender = new TokenSpender();
        token.approve(address(spender), 20);
        vm.expectRevert(bytes("ERC20: zero recipient"));
        spender.spend(token, address(this), address(0), 1);
        assertEq(token.allowance(address(this), address(spender)), 20);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        spender.spend(token, address(this), address(0xBEEF), 21);
        assertEq(token.allowance(address(this), address(spender)), 20);
        token.transfer(address(0xCAFE), token.totalSupply());
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        spender.spend(token, address(this), address(0xBEEF), 1);
        assertEq(token.allowance(address(this), address(spender)), 20);
        assertEq(token.balanceOf(address(0xBEEF)), 0);
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
