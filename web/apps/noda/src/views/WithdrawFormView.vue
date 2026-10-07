<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import CoinRow from '../components/CoinRow.vue'
import { currencies, form, limits, wallets } from '../placeholders/withdraw'

const card = 'rounded-[10px] border border-line bg-[#02040E]'
const title = 'border-b border-line pb-[20.5px] pl-[14px] pt-[19.5px] text-[18px] leading-none font-medium lg:pb-[31px] lg:pl-[29px] lg:pt-[29px] lg:text-[22px] lg:font-semibold'
const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[16px] lg:font-medium lg:text-white'
const input = 'flex h-[35px] items-center rounded-[5px] border-[0.5px] border-card-line bg-field pl-[9px] pr-[10.5px] text-[12px] font-medium text-muted lg:h-[50px] lg:pl-[17px] lg:pr-[19px] lg:text-[14px]'
const field = 'min-w-0 flex-1 bg-transparent text-white placeholder:text-muted'
const line = 'flex items-center justify-between text-[12px] leading-none lg:text-[16px]'
</script>

<template>
  <div class="mt-[20px] grid grid-cols-1 gap-[30px] lg:mt-[15px] lg:grid-cols-2">
    <section :class="card">
      <h2 :class="title">Withdraw Details</h2>
      <div class="px-[14px] pb-[29px] pt-[20.5px] lg:px-[29px] lg:pt-[32px]">
        <p :class="label">Select Currency</p>
        <!-- Only the mockup's choice is selected; picking another is not drawn. -->
        <div class="mt-[16.5px] flex gap-[8.33px] lg:-ml-px lg:mt-[22px] lg:gap-[15px]">
          <button
            v-for="currency in currencies"
            :key="currency"
            type="button"
            :aria-pressed="currency === form.currency"
            class="currency-chip grid h-[34px] w-[61px] place-items-center rounded-[10px] text-[12px] leading-none font-semibold lg:h-[45px] lg:w-auto lg:max-w-[111px] lg:flex-1 lg:text-[18px] lg:font-medium"
            :class="currency === form.currency ? 'text-white' : 'text-accent'"
          >{{ currency }}</button>
        </div>

        <p class="mt-[25.5px] lg:mt-[39px]" :class="label">Amount</p>
        <label class="mt-[16.5px] lg:mt-[17px]" :class="input">
          <input type="text" inputmode="decimal" placeholder="0.00" aria-label="Amount" :class="field" />
          {{ form.currency }}
        </label>
        <p class="mt-[10.5px] flex items-center justify-between text-[10px] leading-none font-medium text-muted lg:mt-[14.5px] lg:text-[14px]">
          Available: {{ form.available }}
          <button type="button" class="font-semibold text-accent underline underline-offset-[2.5px] lg:underline-offset-[3px]">Max</button>
        </p>

        <p class="mt-[36.5px] lg:mt-[31.5px]" :class="label">Destination Address</p>
        <label class="mt-[17px] lg:mt-[17.5px]" :class="input">
          <input type="text" placeholder="Enter wallet address" aria-label="Destination address" :class="field" />
        </label>

        <div class="mt-[15px] space-y-[12px] rounded-[10px] border border-card-line bg-card px-[8.5px] pb-[16px] pt-[14px] lg:-ml-px lg:mt-[30px] lg:space-y-[22px] lg:px-[18.5px] lg:py-[25px]">
          <p class="font-semibold lg:font-medium" :class="line">
            Network fee
            <span class="lg:text-[18px] lg:font-[450]">{{ form.fee }}</span>
          </p>
          <p class="font-semibold lg:font-medium" :class="line">
            You will receive
            <span class="text-accent lg:text-[18px] lg:font-[450]">{{ form.receive }}</span>
          </p>
        </div>

        <div class="mt-[15px] flex rounded-[10px] border-[0.5px] border-yellow bg-warn pb-[15px] pl-[11px] pt-[16.5px] text-yellow [--icon-scale:0.78] lg:-ml-px lg:border lg:pb-[20.5px] lg:pl-[21px] lg:pt-[22.5px] lg:[--icon-scale:1]">
          <AppIcon name="info" class="-mt-[0.5px] lg:-mt-[1.5px]" />
          <div class="ml-[9px] text-[12px] lg:ml-[9.5px] lg:text-[14px]">
            <p class="leading-none font-semibold">important:</p>
            <p class="mt-[13.5px] max-w-[200px] leading-[14px] lg:mt-[14.5px] lg:max-w-none lg:leading-[16px]">
              Please ensure the address is correct.<br />Transactions cannot be reversed once confirmed.
            </p>
          </div>
        </div>

        <button type="button" class="bg-cta mt-[15px] h-[45px] w-full rounded-[5px] border-[0.5px] border-card-line text-[12px] font-semibold lg:mt-[20px] lg:h-[50px] lg:text-[16px] lg:font-medium">Withdraw now</button>
      </div>
    </section>

    <div class="flex flex-col gap-[30px]">
      <section :class="card">
        <h2 :class="title">Your Wallets</h2>
        <ul class="space-y-[10px] px-[14px] pb-[19px] pt-[20px] lg:space-y-[20px] lg:px-[29px] lg:pb-[29px] lg:pt-[30px]">
          <CoinRow v-for="wallet in wallets" :key="wallet.symbol" :coin="wallet.coin" :symbol="wallet.symbol" :name="wallet.name" :detail="wallet.amount" />
        </ul>
      </section>

      <section :class="card">
        <h2 :class="title">Withdraw Limits</h2>
        <div class="px-[14px] pb-[21px] pt-[19.5px] lg:px-[29px] lg:pb-[31.5px] lg:pt-[34.5px]">
          <p class="flex items-start justify-between leading-none">
            <span class="text-[12px] font-semibold text-muted lg:mt-px lg:text-[16px] lg:font-medium">Daily Limit</span>
            <span class="text-[14px] font-semibold lg:text-[22px]">{{ limits.daily }}</span>
          </p>
          <div class="mt-[15.5px] h-[10px] rounded-full bg-card lg:mt-[12.5px]">
            <div class="bg-teal-rise h-full rounded-full" :style="{ width: `${limits.usedShare}%` }" />
          </div>
          <p class="mt-[10.5px] text-[12px] leading-none font-semibold text-muted lg:mt-[17px] lg:text-[16px] lg:font-medium">{{ limits.used }}</p>

          <div class="mt-[30.5px] space-y-[22px] border-t border-line pt-[20px] font-semibold text-muted lg:mt-[31px] lg:space-y-[24px] lg:pt-[31.5px] lg:font-medium">
            <p :class="line">Minimum withdrawal <span class="font-medium text-white lg:-mr-px">{{ limits.minimum }}</span></p>
            <p :class="line">Processing time <span class="font-medium text-white lg:-mr-px">{{ limits.processing }}</span></p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
