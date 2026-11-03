/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/noxvault.json`.
 */
export type Noxvault = {
  "address": "8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4",
  "metadata": {
    "name": "noxvault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "appendLetter",
      "docs": [
        "Writes the next chunk of a letter's ciphertext, at `offset` == bytes filled so far."
      ],
      "discriminator": [
        139,
        59,
        39,
        30,
        97,
        16,
        198,
        218
      ],
      "accounts": [
        {
          "name": "key",
          "signer": true
        },
        {
          "name": "vault",
          "relations": [
            "letterKey",
            "letter"
          ]
        },
        {
          "name": "letterKey",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114,
                  107,
                  101,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "letter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u32"
        },
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "data",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "applyLinkChange",
      "discriminator": [
        75,
        79,
        194,
        237,
        147,
        88,
        89,
        179
      ],
      "accounts": [
        {
          "name": "link",
          "writable": true
        },
        {
          "name": "canary",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  110,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "approve",
      "docs": [
        "Turns a verified signature into an approval of its action and burns the key."
      ],
      "discriminator": [
        69,
        74,
        217,
        36,
        115,
        117,
        97,
        76
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "approval",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  112,
                  112,
                  114,
                  111,
                  118,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "actionHash"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "actionHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancelUnlock",
      "discriminator": [
        116,
        58,
        36,
        132,
        24,
        104,
        170,
        228
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true,
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeLetter",
      "docs": [
        "Deletes a letter; its rent goes back to the letter key."
      ],
      "discriminator": [
        15,
        189,
        215,
        72,
        241,
        80,
        173,
        183
      ],
      "accounts": [
        {
          "name": "key",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "relations": [
            "letterKey",
            "letter"
          ]
        },
        {
          "name": "letterKey",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114,
                  107,
                  101,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "letter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u32"
        }
      ]
    },
    {
      "name": "discardApproval",
      "docs": [
        "Closes an approval that never reached its threshold, after 7 days."
      ],
      "discriminator": [
        252,
        8,
        158,
        25,
        35,
        99,
        43,
        27
      ],
      "accounts": [
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "escapeSol",
      "docs": [
        "Moves all of a wallet's SOL into its linked vault. Signed by the wallet, usually in a",
        "pre-signed durable-nonce transaction stored in the link (docs/SPEC.md §7)."
      ],
      "discriminator": [
        193,
        113,
        112,
        207,
        247,
        132,
        61,
        217
      ],
      "accounts": [
        {
          "name": "wallet",
          "writable": true,
          "signer": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "link",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "escapeToken",
      "docs": [
        "Moves a delegated token account of a linked wallet into its vault. Permissionless once",
        "the canary has tripped or the wallet pressed panic."
      ],
      "discriminator": [
        221,
        213,
        228,
        68,
        24,
        252,
        108,
        85
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "link",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "link.wallet",
                "account": "link"
              }
            ]
          }
        },
        {
          "name": "canary",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  110,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "escape",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  97,
                  112,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "link.wallet",
                "account": "link"
              }
            ]
          }
        },
        {
          "name": "source",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "relations": [
            "link"
          ]
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeAdmin",
      "docs": [
        "Cancel, Ping, CancelSchedule, CancelBudget and Migrate."
      ],
      "discriminator": [
        194,
        19,
        107,
        147,
        207,
        128,
        26,
        106
      ],
      "accounts": [
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "schedule",
          "writable": true,
          "optional": true
        },
        {
          "name": "budget",
          "writable": true,
          "optional": true
        },
        {
          "name": "newState",
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeCreateBudget",
      "discriminator": [
        165,
        175,
        253,
        208,
        235,
        187,
        82,
        152
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "budget",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "noxAccount",
          "docs": [
            "The vault's $NOX account, if any: sets its tier."
          ],
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u8"
        }
      ]
    },
    {
      "name": "executeCreateSchedule",
      "discriminator": [
        109,
        194,
        113,
        4,
        86,
        129,
        168,
        130
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "schedule",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "noxAccount",
          "docs": [
            "The vault's $NOX account, if any: sets its tier."
          ],
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u8"
        }
      ]
    },
    {
      "name": "executeLetterKey",
      "docs": [
        "LetterKey (docs/SPEC.md §12): only a signer-threshold approval sets the letter key. Duress",
        "and recovery approvals never do, not even after the owner's inactivity."
      ],
      "discriminator": [
        38,
        84,
        127,
        113,
        21,
        106,
        19,
        176
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "letterKey",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114,
                  107,
                  101,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executePending",
      "docs": [
        "Pays the pending SOL withdrawal, or starts the pending migration, once due."
      ],
      "discriminator": [
        207,
        36,
        5,
        220,
        230,
        106,
        57,
        181
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executePendingToken",
      "discriminator": [
        154,
        74,
        76,
        145,
        26,
        82,
        200,
        60
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeStake",
      "discriminator": [
        123,
        140,
        82,
        174,
        137,
        211,
        238,
        49
      ],
      "accounts": [
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "stake",
          "writable": true
        },
        {
          "name": "vote"
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "stakeHistory",
          "address": "SysvarStakeHistory1111111111111111111111111"
        },
        {
          "name": "stakeConfig",
          "address": "StakeConfig11111111111111111111111111111111"
        },
        {
          "name": "stakeProgram",
          "address": "Stake11111111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeStakeAuthority",
      "docs": [
        "Unstake and CollectStake."
      ],
      "discriminator": [
        135,
        96,
        6,
        219,
        111,
        189,
        26,
        39
      ],
      "accounts": [
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "stake",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "stakeHistory",
          "address": "SysvarStakeHistory1111111111111111111111111"
        },
        {
          "name": "stakeProgram",
          "address": "Stake11111111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeWithdraw",
      "discriminator": [
        255,
        93,
        15,
        141,
        187,
        94,
        246,
        162
      ],
      "accounts": [
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeWithdrawToken",
      "discriminator": [
        18,
        107,
        61,
        210,
        131,
        233,
        159,
        214
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "approval",
          "writable": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "approval"
          ]
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "approval",
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "freezeProtocol",
      "docs": [
        "Makes the parameters permanent."
      ],
      "discriminator": [
        71,
        172,
        134,
        201,
        58,
        64,
        166,
        16
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "protocol"
          ]
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initCanary",
      "discriminator": [
        195,
        221,
        148,
        71,
        32,
        85,
        6,
        118
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "canary",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  110,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "watched",
          "address": "6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initProtocol",
      "discriminator": [
        3,
        188,
        141,
        237,
        225,
        226,
        232,
        210
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "protocolParams"
            }
          }
        }
      ]
    },
    {
      "name": "initVault",
      "discriminator": [
        77,
        79,
        85,
        150,
        33,
        217,
        52,
        106
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault"
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "noxAccount",
          "docs": [
            "The vault's $NOX account, if any: sets its tier."
          ],
          "optional": true
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "config"
            }
          }
        }
      ]
    },
    {
      "name": "migrateSol",
      "discriminator": [
        105,
        160,
        47,
        234,
        197,
        31,
        168,
        60
      ],
      "accounts": [
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "newVault",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "migrateToken",
      "discriminator": [
        122,
        231,
        115,
        178,
        231,
        187,
        185,
        75
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "newVault",
          "writable": true
        },
        {
          "name": "newAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "newVault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openUnlock",
      "discriminator": [
        197,
        205,
        244,
        64,
        180,
        220,
        149,
        55
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "unlock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tree",
          "type": "u8"
        },
        {
          "name": "leaf",
          "type": "u16"
        },
        {
          "name": "pkSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "authPath",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        },
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "action"
            }
          }
        }
      ]
    },
    {
      "name": "raiseBaseline",
      "docs": [
        "Records a higher bounty as the new baseline (anyone may top the canary up)."
      ],
      "discriminator": [
        94,
        82,
        159,
        121,
        123,
        195,
        193,
        125
      ],
      "accounts": [
        {
          "name": "canary",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  110,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "watched",
          "address": "6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9"
        }
      ],
      "args": []
    },
    {
      "name": "registerLink",
      "discriminator": [
        107,
        165,
        116,
        196,
        1,
        176,
        74,
        123
      ],
      "accounts": [
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "requestLinkChange",
      "discriminator": [
        229,
        138,
        199,
        183,
        86,
        158,
        85,
        123
      ],
      "accounts": [
        {
          "name": "wallet",
          "signer": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "newState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "newVault"
              }
            ]
          }
        },
        {
          "name": "newVault"
        },
        {
          "name": "canary",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  110,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "runSchedule",
      "discriminator": [
        179,
        112,
        243,
        195,
        32,
        69,
        224,
        206
      ],
      "accounts": [
        {
          "name": "schedule",
          "writable": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "schedule",
            "state"
          ]
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "runScheduleToken",
      "discriminator": [
        148,
        4,
        104,
        76,
        50,
        201,
        40,
        5
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "schedule",
          "writable": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "schedule",
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setEscapeTx",
      "discriminator": [
        119,
        71,
        209,
        119,
        227,
        212,
        172,
        63
      ],
      "accounts": [
        {
          "name": "wallet",
          "signer": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "tx",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "setPanic",
      "discriminator": [
        210,
        198,
        251,
        142,
        23,
        5,
        70,
        145
      ],
      "accounts": [
        {
          "name": "wallet",
          "signer": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "on",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setProtocolAdmin",
      "docs": [
        "Hands the parameters to another admin (a multisig, later governance)."
      ],
      "discriminator": [
        48,
        249,
        109,
        189,
        157,
        197,
        31,
        183
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "protocol"
          ]
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "spendBudget",
      "docs": [
        "An ordinary session key spends from its budget (docs/SPEC.md §4)."
      ],
      "discriminator": [
        227,
        32,
        78,
        174,
        128,
        2,
        160,
        7
      ],
      "accounts": [
        {
          "name": "session",
          "signer": true,
          "relations": [
            "budget"
          ]
        },
        {
          "name": "budget",
          "writable": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "budget",
            "state"
          ]
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "spendBudgetToken",
      "discriminator": [
        130,
        186,
        45,
        152,
        124,
        10,
        119,
        95
      ],
      "accounts": [
        {
          "name": "session",
          "writable": true,
          "signer": true,
          "relations": [
            "budget"
          ]
        },
        {
          "name": "budget",
          "writable": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "budget",
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sweepInbox",
      "discriminator": [
        33,
        193,
        180,
        97,
        49,
        195,
        17,
        146
      ],
      "accounts": [
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "inbox",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  98,
                  111,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u32"
        }
      ]
    },
    {
      "name": "sweepInboxToken",
      "discriminator": [
        168,
        37,
        3,
        30,
        57,
        56,
        200,
        63
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "inbox",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  98,
                  111,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "inboxAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "inbox"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u32"
        }
      ]
    },
    {
      "name": "testamentSol",
      "docs": [
        "Splits all SOL among the heirs; heirs are the remaining accounts, in config order."
      ],
      "discriminator": [
        216,
        86,
        26,
        133,
        139,
        61,
        67,
        215
      ],
      "accounts": [
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "testamentStake",
      "discriminator": [
        97,
        232,
        34,
        252,
        226,
        6,
        173,
        30
      ],
      "accounts": [
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "stake",
          "writable": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "stakeHistory",
          "address": "SysvarStakeHistory1111111111111111111111111"
        },
        {
          "name": "stakeProgram",
          "address": "Stake11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "seed",
          "type": "u8"
        },
        {
          "name": "collect",
          "type": "bool"
        }
      ]
    },
    {
      "name": "testamentToken",
      "docs": [
        "Splits all of one token among the heirs; remaining accounts are the heirs' token",
        "accounts for this mint, in config order (create them first)."
      ],
      "discriminator": [
        114,
        173,
        52,
        139,
        84,
        113,
        244,
        102
      ],
      "accounts": [
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "tripCanary",
      "docs": [
        "Trips the canary if its bounty moved: only possible if ed25519 is broken."
      ],
      "discriminator": [
        194,
        111,
        209,
        10,
        16,
        19,
        164,
        249
      ],
      "accounts": [
        {
          "name": "canary",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  110,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "watched",
          "address": "6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9"
        }
      ],
      "args": []
    },
    {
      "name": "updateProtocol",
      "discriminator": [
        206,
        25,
        218,
        114,
        109,
        41,
        74,
        173
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "protocol"
          ]
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "protocolParams"
            }
          }
        }
      ]
    },
    {
      "name": "verify",
      "docs": [
        "Walks chains `from..to` to their ends. Freezes the buffer on first use. Permissionless."
      ],
      "discriminator": [
        133,
        161,
        141,
        48,
        120,
        198,
        88,
        150
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "from",
          "type": "u8"
        },
        {
          "name": "to",
          "type": "u8"
        }
      ]
    },
    {
      "name": "writeLetter",
      "docs": [
        "Creates or overwrites letter `id`: sizes it for `len` ciphertext bytes and writes the first",
        "`data` bytes (the rest follows with `append_letter`). Signed and paid by the letter key;",
        "never touches the vault's funds or its activity clock."
      ],
      "discriminator": [
        3,
        237,
        216,
        96,
        81,
        249,
        12,
        7
      ],
      "accounts": [
        {
          "name": "key",
          "docs": [
            "The vault's letter key: signs and pays."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "relations": [
            "letterKey"
          ]
        },
        {
          "name": "letterKey",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114,
                  107,
                  101,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "letter",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  116,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u32"
        },
        {
          "name": "unlockRound",
          "type": "u64"
        },
        {
          "name": "label",
          "type": "bytes"
        },
        {
          "name": "len",
          "type": "u32"
        },
        {
          "name": "data",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "writeSigs",
      "discriminator": [
        216,
        242,
        142,
        114,
        134,
        77,
        2,
        154
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true,
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "vault",
          "docs": [
            "signature bytes shows up in the vault's history (docs/SPEC.md §9)."
          ],
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "start",
          "type": "u8"
        },
        {
          "name": "sigs",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "approval",
      "discriminator": [
        233,
        9,
        153,
        49,
        11,
        222,
        59,
        130
      ]
    },
    {
      "name": "budget",
      "discriminator": [
        35,
        151,
        58,
        65,
        187,
        148,
        119,
        218
      ]
    },
    {
      "name": "canary",
      "discriminator": [
        192,
        209,
        214,
        197,
        87,
        28,
        82,
        115
      ]
    },
    {
      "name": "letter",
      "discriminator": [
        209,
        169,
        19,
        117,
        140,
        190,
        145,
        212
      ]
    },
    {
      "name": "letterKey",
      "discriminator": [
        30,
        105,
        15,
        91,
        187,
        160,
        26,
        16
      ]
    },
    {
      "name": "link",
      "discriminator": [
        90,
        57,
        179,
        207,
        13,
        91,
        161,
        190
      ]
    },
    {
      "name": "protocol",
      "discriminator": [
        45,
        39,
        101,
        43,
        115,
        72,
        131,
        40
      ]
    },
    {
      "name": "schedule",
      "discriminator": [
        217,
        243,
        116,
        56,
        73,
        82,
        207,
        51
      ]
    },
    {
      "name": "unlock",
      "discriminator": [
        187,
        122,
        21,
        254,
        7,
        157,
        241,
        10
      ]
    },
    {
      "name": "vaultState",
      "discriminator": [
        228,
        196,
        82,
        165,
        98,
        210,
        235,
        152
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "wrongVault",
      "msg": "The vault address does not match"
    },
    {
      "code": 6001,
      "name": "badConfig",
      "msg": "Invalid vault config"
    },
    {
      "code": 6002,
      "name": "badTree",
      "msg": "Unknown tree, wrong auth path length or leaf out of range"
    },
    {
      "code": 6003,
      "name": "keyUsed",
      "msg": "This one-time key has already been used"
    },
    {
      "code": 6004,
      "name": "destIsVault",
      "msg": "The destination cannot be the vault itself"
    },
    {
      "code": 6005,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6006,
      "name": "badAction",
      "msg": "Invalid action"
    },
    {
      "code": 6007,
      "name": "frozen",
      "msg": "The signature can no longer change: verification has started"
    },
    {
      "code": 6008,
      "name": "chainOutOfRange",
      "msg": "Chain index out of range"
    },
    {
      "code": 6009,
      "name": "signatureIncomplete",
      "msg": "Not every chain of the signature has been written"
    },
    {
      "code": 6010,
      "name": "notVerified",
      "msg": "Not every chain has been verified"
    },
    {
      "code": 6011,
      "name": "badSignature",
      "msg": "The signature does not match this vault's keys"
    },
    {
      "code": 6012,
      "name": "wrongPayer",
      "msg": "Rent receiver must be the account that opened the unlock"
    },
    {
      "code": 6013,
      "name": "wrongAction",
      "msg": "This instruction cannot execute this action"
    },
    {
      "code": 6014,
      "name": "wrongDest",
      "msg": "Destination does not match"
    },
    {
      "code": 6015,
      "name": "wrongFeePayee",
      "msg": "Fee payee does not match the signed action"
    },
    {
      "code": 6016,
      "name": "wrongStake",
      "msg": "Stake account does not match"
    },
    {
      "code": 6017,
      "name": "insufficientFunds",
      "msg": "The vault holds less than this needs"
    },
    {
      "code": 6018,
      "name": "rentDust",
      "msg": "The vault would be left with less SOL than the rent minimum"
    },
    {
      "code": 6019,
      "name": "notApproved",
      "msg": "Not enough approvals"
    },
    {
      "code": 6020,
      "name": "recoveryLocked",
      "msg": "The recovery key may only cancel until the owner has been inactive long enough"
    },
    {
      "code": 6021,
      "name": "notWhitelisted",
      "msg": "This destination is not allowed by the vault's rules"
    },
    {
      "code": 6022,
      "name": "pendingExists",
      "msg": "Something is already pending"
    },
    {
      "code": 6023,
      "name": "noPending",
      "msg": "Nothing is pending"
    },
    {
      "code": 6024,
      "name": "notYet",
      "msg": "Not yet"
    },
    {
      "code": 6025,
      "name": "missingAccount",
      "msg": "A required account is missing"
    },
    {
      "code": 6026,
      "name": "budgetExpired",
      "msg": "This budget has expired"
    },
    {
      "code": 6027,
      "name": "overBudget",
      "msg": "This would exceed the budget for this period"
    },
    {
      "code": 6028,
      "name": "noTestament",
      "msg": "This vault has no testament"
    },
    {
      "code": 6029,
      "name": "canaryTripped",
      "msg": "The quantum canary has tripped"
    },
    {
      "code": 6030,
      "name": "notTriggered",
      "msg": "The Escape Hatch has not been triggered"
    },
    {
      "code": 6031,
      "name": "notDelegated",
      "msg": "This token account has not delegated to the Escape Hatch"
    },
    {
      "code": 6032,
      "name": "tierTooLow",
      "msg": "This needs a higher $NOX tier: hold more $NOX in the vault"
    },
    {
      "code": 6033,
      "name": "notAdmin",
      "msg": "Only the protocol admin can do this"
    },
    {
      "code": 6034,
      "name": "lockdown",
      "msg": "The vault is in lockdown: only Ping and cancels execute until it ends"
    },
    {
      "code": 6035,
      "name": "duressSolOnly",
      "msg": "A duress approval can only withdraw SOL"
    },
    {
      "code": 6036,
      "name": "letterKeySignersOnly",
      "msg": "Only the vault's signers can set the letter key (not duress or recovery)"
    },
    {
      "code": 6037,
      "name": "notLetterKey",
      "msg": "This key is not the vault's letter key"
    },
    {
      "code": 6038,
      "name": "letterTooBig",
      "msg": "Letter too big: at most 8192 ciphertext bytes and a 64-byte label"
    },
    {
      "code": 6039,
      "name": "letterOverflow",
      "msg": "Letter chunk out of order or past the letter's length"
    }
  ],
  "types": [
    {
      "name": "action",
      "docs": [
        "What one approval authorizes. Signed as borsh bytes (docs/SPEC.md §4)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "kind"
              }
            }
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "feePayee",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "approval",
      "docs": [
        "Approvals collected for one action (docs/SPEC.md §4)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "actionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "action",
            "type": {
              "array": [
                "u8",
                160
              ]
            }
          },
          {
            "name": "actionLen",
            "type": "u16"
          },
          {
            "name": "trees",
            "docs": [
              "Bit t set once tree t approved."
            ],
            "type": "u8"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "budget",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u8"
          },
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "limit",
            "type": "u64"
          },
          {
            "name": "period",
            "type": "i64"
          },
          {
            "name": "expires",
            "type": "i64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "spent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "canary",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "watched",
            "type": "pubkey"
          },
          {
            "name": "baseline",
            "type": "u64"
          },
          {
            "name": "tripped",
            "type": "bool"
          },
          {
            "name": "trippedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "The rules of a vault. Its hash is part of the vault address, so it can never change."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trees",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tree"
                  }
                },
                4
              ]
            }
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "recoveryDelay",
            "type": "i64"
          },
          {
            "name": "whitelist",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "slowDelay",
            "type": "i64"
          },
          {
            "name": "instantLimit",
            "type": "u64"
          },
          {
            "name": "heirs",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "heir"
                  }
                },
                4
              ]
            }
          },
          {
            "name": "testamentDelay",
            "type": "i64"
          },
          {
            "name": "duress",
            "docs": [
              "Duress tree: always filled (a random root when the owner set no duress phrase), so",
              "every vault looks the same (docs/SPEC.md §11)."
            ],
            "type": {
              "defined": {
                "name": "tree"
              }
            }
          },
          {
            "name": "duressLimit",
            "docs": [
              "Lamports a duress withdrawal pays out at once."
            ],
            "type": "u64"
          },
          {
            "name": "duressLock",
            "docs": [
              "Lockdown length after a duress withdrawal (at least one day)."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "heir",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "addr",
            "type": "pubkey"
          },
          {
            "name": "bps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "kind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "withdraw",
            "fields": [
              {
                "name": "mint",
                "type": "pubkey"
              },
              {
                "name": "dest",
                "type": "pubkey"
              },
              {
                "name": "amount",
                "type": "u64"
              }
            ]
          },
          {
            "name": "stake",
            "fields": [
              {
                "name": "seed",
                "type": "u8"
              },
              {
                "name": "vote",
                "type": "pubkey"
              },
              {
                "name": "amount",
                "type": "u64"
              }
            ]
          },
          {
            "name": "unstake",
            "fields": [
              {
                "name": "seed",
                "type": "u8"
              }
            ]
          },
          {
            "name": "collectStake",
            "fields": [
              {
                "name": "seed",
                "type": "u8"
              }
            ]
          },
          {
            "name": "cancel"
          },
          {
            "name": "ping"
          },
          {
            "name": "schedule",
            "fields": [
              {
                "name": "id",
                "type": "u8"
              },
              {
                "name": "mint",
                "type": "pubkey"
              },
              {
                "name": "dest",
                "type": "pubkey"
              },
              {
                "name": "amount",
                "type": "u64"
              },
              {
                "name": "interval",
                "type": "i64"
              },
              {
                "name": "count",
                "type": "u16"
              },
              {
                "name": "start",
                "type": "i64"
              }
            ]
          },
          {
            "name": "cancelSchedule",
            "fields": [
              {
                "name": "id",
                "type": "u8"
              }
            ]
          },
          {
            "name": "budget",
            "fields": [
              {
                "name": "id",
                "type": "u8"
              },
              {
                "name": "session",
                "type": "pubkey"
              },
              {
                "name": "mint",
                "type": "pubkey"
              },
              {
                "name": "limit",
                "type": "u64"
              },
              {
                "name": "period",
                "type": "i64"
              },
              {
                "name": "expires",
                "type": "i64"
              }
            ]
          },
          {
            "name": "cancelBudget",
            "fields": [
              {
                "name": "id",
                "type": "u8"
              }
            ]
          },
          {
            "name": "migrate",
            "fields": [
              {
                "name": "newVault",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "letterKey",
            "fields": [
              {
                "name": "key",
                "type": "pubkey"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "letter",
      "docs": [
        "One sealed letter: tlock ciphertext only, written by the vault's letter key.",
        "PDA [\"letter\", vault, u32le(id)]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "unlockRound",
            "docs": [
              "drand quicknet round after which the ciphertext can be decrypted."
            ],
            "type": "u64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "filled",
            "docs": [
              "Bytes of `content` written so far; the letter is complete when filled == content.len()."
            ],
            "type": "u32"
          },
          {
            "name": "label",
            "docs": [
              "Short plaintext label / recipient hint (at most MAX_LETTER_LABEL bytes)."
            ],
            "type": "bytes"
          },
          {
            "name": "content",
            "docs": [
              "Opaque ciphertext (at most MAX_LETTER bytes)."
            ],
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "letterKey",
      "docs": [
        "The key allowed to write a vault's sealed letters (docs/SPEC.md §12). A separate account so",
        "`VaultState` keeps its layout. PDA [\"letterkey\", vault]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "key",
            "docs": [
              "default = no letter key (revoked)."
            ],
            "type": "pubkey"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "link",
      "docs": [
        "An ordinary wallet's link to its vault: registry entry and Escape Hatch (docs/SPEC.md §7)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "panic",
            "type": "bool"
          },
          {
            "name": "change",
            "type": {
              "option": {
                "defined": {
                  "name": "linkChange"
                }
              }
            }
          },
          {
            "name": "escapeTx",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "linkChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pending",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "dest",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "executableAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "protocol",
      "docs": [
        "Protocol parameters: the $NOX mint, tier thresholds and fees (docs/SPEC.md §10)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "protocolParams"
              }
            }
          },
          {
            "name": "frozen",
            "docs": [
              "Once true, nothing here can change again."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "protocolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "noxMint",
            "docs": [
              "default = tiers off: every feature open to everyone."
            ],
            "type": "pubkey"
          },
          {
            "name": "guardian",
            "docs": [
              "$NOX base units a vault must hold for each tier."
            ],
            "type": "u64"
          },
          {
            "name": "sentinel",
            "type": "u64"
          },
          {
            "name": "createFee",
            "docs": [
              "Lamports a free-tier vault pays the treasury once, at creation."
            ],
            "type": "u64"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "schedule",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "dest",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "interval",
            "type": "i64"
          },
          {
            "name": "remaining",
            "type": "u16"
          },
          {
            "name": "nextAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tree",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "height",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "unlock",
      "docs": [
        "A signed action being assembled and verified over several transactions.",
        "Zero-copy: the signature and chain ends are too big for the BPF stack."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "written",
            "type": "u64"
          },
          {
            "name": "verified",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "pkSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "authPath",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                8
              ]
            }
          },
          {
            "name": "action",
            "type": {
              "array": [
                "u8",
                160
              ]
            }
          },
          {
            "name": "actionLen",
            "type": "u16"
          },
          {
            "name": "leaf",
            "type": "u16"
          },
          {
            "name": "tree",
            "type": "u8"
          },
          {
            "name": "height",
            "type": "u8"
          },
          {
            "name": "frozen",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "digits",
            "type": {
              "array": [
                "u8",
                34
              ]
            }
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "sigs",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                34
              ]
            }
          },
          {
            "name": "ends",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                34
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vaultState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "configHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "config"
              }
            }
          },
          {
            "name": "used",
            "docs": [
              "Bit l of used[t] set once leaf l of tree t has been used (t = 4: duress tree)."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                5
              ]
            }
          },
          {
            "name": "lastActive",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "actions",
            "type": "u32"
          },
          {
            "name": "pending",
            "type": {
              "option": {
                "defined": {
                  "name": "pending"
                }
              }
            }
          },
          {
            "name": "windowStart",
            "docs": [
              "24 h window for the instant limit."
            ],
            "type": "i64"
          },
          {
            "name": "windowSpent",
            "type": "u64"
          },
          {
            "name": "migrateTo",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "lockdownUntil",
            "docs": [
              "Until then only Ping and cancels execute (set by a duress withdrawal, docs/SPEC.md §11)."
            ],
            "type": "i64"
          }
        ]
      }
    }
  ]
};
